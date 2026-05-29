import fs from 'fs';
import path from 'path';
import { mockfs } from './helpers.js';
import {
  SmartSnapBailError,
  validateAndReadStats,
  getBaselineAndAffectedNodes,
  assertNoDotStorybookChange,
  assertNoBailOnChanges,
  enforceUntraced,
  getAffectedPackages,
  extractStorybookPaths,
  runGraphGeneration,
  maybeWriteTrace,
  selectAffectedSnapshots
} from '../src/smartsnap.js';

// Injected logger stub — every extracted function takes its `log` as an
// argument, so we hand it spies rather than reaching for the global logger.
function mockLog() {
  return {
    debug: jasmine.createSpy('debug'),
    info: jasmine.createSpy('info'),
    warn: jasmine.createSpy('warn')
  };
}

// Assert an async call rejects with a SmartSnapBailError whose message carries
// `substr`. Returns the caught error for any further assertions.
async function expectBail(fn, substr) {
  let err;
  try {
    await fn();
  } catch (e) {
    err = e;
  }
  expect(err).toBeInstanceOf(SmartSnapBailError);
  if (substr) expect(err.message).toContain(substr);
  return err;
}

// Identity normalizer: the path-frame translation is exercised end-to-end via
// applySmartSnap; here we feed already-normalized importPaths so each unit test
// stays focused on its own branch.
const identity = p => p;

describe('smartsnap', () => {
  describe('validateAndReadStats()', () => {
    const log = mockLog();

    it('bails when the statsFile is not a .json filename', async () => {
      await expectBail(
        () => validateAndReadStats('/build', 'stats.txt', '/root', log),
        'invalid statsFile');
    });

    it('bails when the stats file is missing from the build dir', async () => {
      await mockfs({ '/build': null });
      await expectBail(
        () => validateAndReadStats('/build', undefined, '/root', log),
        'not found in build directory');
    });

    it('bails when the resolved stats path is a directory', async () => {
      await mockfs({ '/build/enriched-stats.json': null });
      await expectBail(
        () => validateAndReadStats('/build', undefined, '/root', log),
        'is not a regular file');
    });

    it('bails when the stats file has no top-level buildId', async () => {
      await mockfs({ '/build/enriched-stats.json': JSON.stringify({ modules: [] }) });
      await expectBail(
        () => validateAndReadStats('/build', undefined, '/root', log),
        'missing a top-level "buildId"');
    });

    it('reads files, modules and buildId from a valid stats file', async () => {
      await mockfs({ '/build/enriched-stats.json': JSON.stringify({ buildId: 'bld-1', modules: [] }) });
      let res = await validateAndReadStats('/build', undefined, '/root', log);
      expect(res).toEqual({ files: [], modules: [], buildId: 'bld-1' });
    });

    it('anchors a traversal-prefixed statsFile inside the build dir via basename', async () => {
      // `path.basename('../../etc/foo.json')` is `foo.json`, so the read stays
      // inside the build dir even when the config tries to escape it.
      await mockfs({ '/build/foo.json': JSON.stringify({ buildId: 'b', modules: [] }) });
      let res = await validateAndReadStats('/build', '../../etc/foo.json', '/root', log);
      expect(res.buildId).toEqual('b');
    });
  });

  // These hit real git (spawnSync is a native ESM binding we can't spy), so we
  // lean on `git diff --name-only HEAD HEAD` being deterministically empty.
  describe('getBaselineAndAffectedNodes()', () => {
    const log = mockLog();

    it('uses an explicit baseline and skips the API base lookup', async () => {
      let lookup = jasmine.createSpy('getSmartsnapSnapshotNameToCommit');
      let percy = { client: { getSmartsnapSnapshotNameToCommit: lookup } };

      let res = await getBaselineAndAffectedNodes(percy, 'HEAD', log);

      expect(res.baseRef).toEqual('HEAD');
      expect(res.baselineSnapshots).toBeNull();
      expect(res.affectedNodes).toEqual([]);
      expect(lookup).not.toHaveBeenCalled();
    });

    it('falls back to the predicted base build commit when no baseline is set', async () => {
      let percy = {
        client: {
          getSmartsnapSnapshotNameToCommit: async () => ({
            base_build_commit_sha: 'HEAD',
            snapshots: { 'Button: primary': 'approved' }
          })
        }
      };

      let res = await getBaselineAndAffectedNodes(percy, undefined, log);

      expect(res.baseRef).toEqual('HEAD');
      expect(res.affectedNodes).toEqual([]);
      expect(res.baselineSnapshots).toEqual({ 'Button: primary': 'approved' });
    });

    it('bails when the API predicts no base commit and no baseline is set', async () => {
      let percy = { client: { getSmartsnapSnapshotNameToCommit: async () => ({}) } };
      await expectBail(
        () => getBaselineAndAffectedNodes(percy, undefined, log),
        'could not predict a base build commit');
    });

    it('bails on an unsafe baseline ref before shelling out to git', async () => {
      let percy = { client: {} };
      await expectBail(
        () => getBaselineAndAffectedNodes(percy, '--upload-pack=evil', log),
        'unsafe baseline ref');
    });
  });

  describe('assertNoDotStorybookChange()', () => {
    it('throws when a changed path lives under .storybook', () => {
      expect(() => assertNoDotStorybookChange(['src/a.js', '.storybook/preview.js']))
        .toThrowMatching(e => e instanceof SmartSnapBailError && e.message.includes('.storybook'));
    });

    it('matches a .storybook segment regardless of separator', () => {
      expect(() => assertNoDotStorybookChange(['a\\.storybook\\main.js'])).toThrow();
    });

    it('does not throw when nothing touches .storybook', () => {
      expect(() => assertNoDotStorybookChange(['src/a.js', 'src/b.css'])).not.toThrow();
    });
  });

  describe('assertNoBailOnChanges()', () => {
    it('is a no-op when no patterns are configured', () => {
      expect(() => assertNoBailOnChanges(['yarn.lock'], undefined)).not.toThrow();
      expect(() => assertNoBailOnChanges(['yarn.lock'], [])).not.toThrow();
    });

    it('bails when a changed file matches a glob pattern', () => {
      expect(() => assertNoBailOnChanges(['yarn.lock'], ['*.lock']))
        .toThrowMatching(e => e instanceof SmartSnapBailError && e.message.includes('yarn.lock'));
    });

    it('bails on an exact (non-glob) pattern match', () => {
      expect(() => assertNoBailOnChanges(['config/settings.js'], ['config/settings.js'])).toThrow();
    });

    it('does not bail when nothing matches', () => {
      expect(() => assertNoBailOnChanges(['src/index.js'], ['*.css'])).not.toThrow();
    });
  });

  describe('enforceUntraced()', () => {
    it('returns the list unchanged when no patterns are configured', () => {
      let nodes = ['src/a.js', 'docs/readme.md'];
      expect(enforceUntraced(nodes, undefined)).toEqual(nodes);
      expect(enforceUntraced(nodes, [])).toEqual(nodes);
    });

    it('drops paths matching an untraced glob', () => {
      let nodes = ['src/a.js', 'docs/readme.md', 'CHANGELOG.md'];
      expect(enforceUntraced(nodes, ['**/*.md'])).toEqual(['src/a.js']);
    });

    it('keeps paths that do not match', () => {
      let nodes = ['src/a.snap', 'src/a.js'];
      expect(enforceUntraced(nodes, ['*.snap'])).toEqual(['src/a.snap', 'src/a.js']);
    });
  });

  describe('getAffectedPackages()', () => {
    const log = mockLog();

    it('returns [] when no manifest files changed', async () => {
      expect(await getAffectedPackages(['src/a.js', 'src/b.css'], 'HEAD', '/root', log)).toEqual([]);
    });

    it('bails when manifest changes span multiple directories', async () => {
      await expectBail(
        () => getAffectedPackages(['package.json', 'sub/package.json'], 'HEAD', '/root', log),
        'span multiple directories');
    });

    it('bails when the manifest dir has no lockfile', async () => {
      await mockfs({ '/root/pkg': null });
      await expectBail(
        () => getAffectedPackages(['pkg/package.json'], 'HEAD', '/root', log),
        'no lockfile present there');
    });

    it('bails when the manifest dir has multiple lockfiles', async () => {
      await mockfs({
        '/root/pkg/yarn.lock': 'yarn',
        '/root/pkg/package-lock.json': '{}'
      });
      await expectBail(
        () => getAffectedPackages(['pkg/package.json'], 'HEAD', '/root', log),
        'multiple lockfiles');
    });
  });

  describe('extractStorybookPaths()', () => {
    it('maps, dedupes and drops snapshots without an importPath', () => {
      let log = mockLog();
      let snapshots = [
        { importPath: 'src/A.stories.js' },
        { importPath: 'src/A.stories.js' },
        { importPath: 'src/B.stories.js' },
        { name: 'no-path' }
      ];
      expect(extractStorybookPaths(snapshots, identity, log))
        .toEqual(['src/A.stories.js', 'src/B.stories.js']);
    });

    it('warns when no snapshot carries an importPath', () => {
      let log = mockLog();
      expect(extractStorybookPaths([{ name: 'x' }], identity, log)).toEqual([]);
      expect(log.warn).toHaveBeenCalledTimes(1);
    });
  });

  describe('runGraphGeneration()', () => {
    it('starts the job and returns the graph payload on done', async () => {
      let log = mockLog();
      let generate = jasmine.createSpy('generateSmartsnapGraph');
      let data = { affected_stories: ['src/A.stories.js'] };
      let percy = {
        client: {
          generateSmartsnapGraph: generate,
          getStatus: async () => ({ status: 'done', data })
        }
      };
      let payload = { files: ['f'], modules: [{ id: 0 }], storybookPaths: ['p'], affectedNodes: ['a'] };

      let res = await runGraphGeneration(percy, 'bld-1', payload, log);

      expect(res).toBe(data);
      expect(generate).toHaveBeenCalledWith('bld-1', payload);
    });

    it('bails when the job does not reach done', async () => {
      let log = mockLog();
      let percy = {
        client: {
          generateSmartsnapGraph: async () => {},
          getStatus: async () => ({ status: 'failure' })
        }
      };
      await expectBail(
        () => runGraphGeneration(percy, 'bld-1', { files: [], modules: [], storybookPaths: [], affectedNodes: [] }, log),
        'did not complete');
    });
  });

  describe('maybeWriteTrace()', () => {
    const fullData = {
      affected_stories: [],
      vertices: [{ kind: 'component', file_path: 'A.jsx' }],
      edges: [],
      transitive_closure_matrix_sparse: []
    };

    it('renders and writes trace.html when enabled with a complete payload', () => {
      let log = mockLog();
      let write = spyOn(fs, 'writeFileSync');

      maybeWriteTrace(true, fullData, log);

      expect(write).toHaveBeenCalledTimes(1);
      let [tracePath, html] = write.calls.mostRecent().args;
      expect(tracePath).toEqual(path.resolve(process.cwd(), 'trace.html'));
      expect(html).toContain('const vertices');
      expect(log.info).toHaveBeenCalled();
    });

    it('does nothing when trace is disabled', () => {
      let log = mockLog();
      let write = spyOn(fs, 'writeFileSync');
      maybeWriteTrace(false, fullData, log);
      expect(write).not.toHaveBeenCalled();
    });

    it('does nothing when the graph payload is incomplete', () => {
      let log = mockLog();
      let write = spyOn(fs, 'writeFileSync');
      maybeWriteTrace(true, { affected_stories: [], vertices: [], edges: [] }, log);
      expect(write).not.toHaveBeenCalled();
    });

    it('warns (without throwing) when the write fails', () => {
      let log = mockLog();
      spyOn(fs, 'writeFileSync').and.throwError('disk full');
      expect(() => maybeWriteTrace(true, fullData, log)).not.toThrow();
      expect(log.warn).toHaveBeenCalled();
    });
  });

  describe('selectAffectedSnapshots()', () => {
    it('keeps only affected snapshots when an explicit baseline is set', () => {
      let log = mockLog();
      let snapshots = [
        { name: 'A', importPath: 'src/A.stories.js' },
        { name: 'B', importPath: 'src/B.stories.js' }
      ];
      let data = { affected_stories: ['src/A.stories.js'] };

      let filtered = selectAffectedSnapshots(snapshots, data, 'main', null, identity, log);

      expect(filtered.map(s => s.name)).toEqual(['A']);
    });

    it('forces re-snapshot for missing, failed and rejected baselines', () => {
      let log = mockLog();
      let snapshots = [
        { name: 'A', importPath: 'src/A.stories.js' }, // affected + approved baseline
        { name: 'B', importPath: 'src/B.stories.js' }, // failed baseline -> forced
        { name: 'C', importPath: 'src/C.stories.js' }, // missing baseline -> forced
        { name: 'D', importPath: 'src/D.stories.js' } // approved + not affected -> dropped
      ];
      let baselineSnapshots = { A: 'approved', B: 'failed', D: 'approved' };
      let data = { affected_stories: ['src/A.stories.js'] };

      let filtered = selectAffectedSnapshots(snapshots, data, undefined, baselineSnapshots, identity, log);

      expect(filtered.map(s => s.name)).toEqual(['A', 'B', 'C']);
    });

    it('keeps nothing when the graph reports no affected stories and a baseline is set', () => {
      let log = mockLog();
      let snapshots = [{ name: 'A', importPath: 'src/A.stories.js' }];
      let filtered = selectAffectedSnapshots(snapshots, { affected_stories: [] }, 'main', null, identity, log);
      expect(filtered).toEqual([]);
    });
  });
});
