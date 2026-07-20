import fs from 'fs';
import os from 'os';
import path from 'path';
import cp from 'child_process';
import { mockfs } from './helpers.js';
import {
  IntelliStoryBailError,
  validateAndReadStats,
  getBaselineAndAffectedNodes,
  assertNoDotStorybookChange,
  assertNoBailOnChanges,
  enforceUntraced,
  getAffectedPackages,
  getAffectedFileLocations,
  extractStorybookPaths,
  runGraphGeneration,
  maybeWriteTrace,
  applyIntelliStory,
  writeIntelliStoryTrace
} from '../src/intelliStory.js';

const NODE_MAJOR = parseInt(process.versions.node.split('.')[0], 10);

const itPosix = path.sep === '/' ? it : xit;

function git(args, cwd) {
  let r = cp.spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr || r.stdout}`);
  return r.stdout;
}

function makeRepo(seed, changed) {
  let dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'intelliStory-')));
  git(['init', '-q'], dir);
  git(['config', 'user.email', 'test@example.com'], dir);
  git(['config', 'user.name', 'Test'], dir);
  let writeAll = files => {
    for (let [rel, content] of Object.entries(files)) {
      let abs = path.join(dir, rel);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, content);
    }
  };
  writeAll(seed);
  git(['add', '-A'], dir);
  git(['commit', '-qm', 'base'], dir);
  let baseSha = git(['rev-parse', 'HEAD'], dir).trim();
  if (changed) {
    writeAll(changed);
    git(['add', '-A'], dir);
    git(['commit', '-qm', 'change'], dir);
  }
  return { dir, baseSha };
}

function mockLog() {
  return {
    debug: jasmine.createSpy('debug'),
    info: jasmine.createSpy('info'),
    warn: jasmine.createSpy('warn')
  };
}

async function expectBail(fn, substr) {
  let err;
  try {
    await fn();
  } catch (e) {
    err = e;
  }
  expect(err).toBeInstanceOf(IntelliStoryBailError);
  if (substr) expect(err.message).toContain(substr);
  return err;
}

const identity = p => p;

describe('intelliStory', () => {
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

    it('reads files and modules from a valid stats file (buildId no longer required)', async () => {
      await mockfs({ '/build/enriched-stats.json': JSON.stringify({ modules: [] }) });
      let res = await validateAndReadStats('/build', undefined, '/root', log);
      expect(res).toEqual({ files: [], modules: [] });
    });

    it('anchors a traversal-prefixed statsFile inside the build dir via basename', async () => {
      await mockfs({ '/build/foo.json': JSON.stringify({ modules: [] }) });
      let res = await validateAndReadStats('/build', '../../etc/foo.json', '/root', log);
      expect(res).toEqual({ files: [], modules: [] });
    });

    it('streams modules: indexes src refs, leaves module refs, drops node_modules/string-id and id-less entries', async () => {
      await mockfs({
        '/build/enriched-stats.json': JSON.stringify({
          buildId: 'b',
          modules: [
            {
              id: '/root/src/A.js',
              imports: [
                { type: 'src', source: '/root/src/B.js', loc: [{ start: 38, end: 38 }, { start: 40, end: 42 }] },
                { type: 'src', source: '/root/src/B.js' },
                { type: 'src', source: 'lib/rel.js' },
                { type: 'module', source: 'react' }
              ],
              passThroughExports: [{ type: 'src', source: '/root/src/C.js', loc: [{ start: 5, end: 5 }] }],
              nonPassThroughExports: [{ type: 'module', source: 'lodash' }]
            },
            { id: '/root/node_modules/dep/index.js' },
            {}
          ]
        })
      });

      let res = await validateAndReadStats('/build', undefined, '/root', log);

      expect(res.files).toEqual([path.join('src', 'A.js'), path.join('src', 'B.js'), path.join('src', 'C.js')]);
      expect(res.modules.length).toEqual(2);
      expect(res.modules[0].id).toEqual(0);
      expect(res.modules[0].imports[0].source).toEqual(1);
      expect(res.modules[0].imports[1].source).toEqual(1);
      expect(res.modules[0].imports[2].source).toEqual('lib/rel.js');
      expect(res.modules[0].imports[3].source).toEqual('react');
      expect(res.modules[0].imports[0].loc).toEqual([[38, 38], [40, 42]]);
      expect(res.modules[0].passThroughExports[0].source).toEqual(2);
      expect(res.modules[0].passThroughExports[0].loc).toEqual([[5, 5]]);
      expect(res.modules[0].nonPassThroughExports).toEqual([{ type: 'module', source: 'lodash' }]);
      expect(res.modules[1]).toEqual({});
    });
  });

  describe('getBaselineAndAffectedNodes()', () => {
    const log = mockLog();

    it('uses an explicit baseline but still calls the API to check for a browser upgrade', async () => {
      let lookup = jasmine.createSpy('getIntelliStorySnapshotNameToCommit')
        .and.resolveTo({ browser_upgrade: false });
      let percy = { client: { getIntelliStorySnapshotNameToCommit: lookup } };

      let res = await getBaselineAndAffectedNodes(percy, 'HEAD', log);

      expect(res.baseRef).toEqual('HEAD');
      expect(res.baselineSnapshots).toBeNull();
      expect(res.affectedNodes).toEqual([]);
      expect(lookup).toHaveBeenCalled();
    });

    it('tolerates the API returning no base lookup when an explicit baseline is set', async () => {
      let percy = { client: { getIntelliStorySnapshotNameToCommit: async () => undefined } };

      let res = await getBaselineAndAffectedNodes(percy, 'HEAD', log);

      expect(res.baseRef).toEqual('HEAD');
      expect(res.baselineSnapshots).toBeNull();
    });

    it('bails when the base lookup reports a browser upgrade, even with an explicit baseline', async () => {
      let percy = {
        client: {
          getIntelliStorySnapshotNameToCommit: async () => ({
            browser_upgrade: true,
            base_build_commit_sha: 'HEAD'
          })
        }
      };
      await expectBail(
        () => getBaselineAndAffectedNodes(percy, 'HEAD', log),
        'this build corresponds to a browser upgrade');
    });

    it('falls back to the predicted base build commit when no baseline is set', async () => {
      let percy = {
        client: {
          getIntelliStorySnapshotNameToCommit: async () => ({
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

    it('defaults baselineSnapshots to {} when the API omits the snapshot map', async () => {
      let percy = { client: { getIntelliStorySnapshotNameToCommit: async () => ({ base_build_commit_sha: 'HEAD' }) } };
      let res = await getBaselineAndAffectedNodes(percy, undefined, log);
      expect(res.baseRef).toEqual('HEAD');
      expect(res.baselineSnapshots).toEqual({});
    });

    it('bails when the API predicts no base commit and no baseline is set', async () => {
      let percy = { client: { getIntelliStorySnapshotNameToCommit: async () => ({}) } };
      await expectBail(
        () => getBaselineAndAffectedNodes(percy, undefined, log),
        'could not predict a base build commit');
    });

    it('bails on an unsafe baseline ref before shelling out to git', async () => {
      let percy = { client: { getIntelliStorySnapshotNameToCommit: async () => ({}) } };
      await expectBail(
        () => getBaselineAndAffectedNodes(percy, '--upload-pack=evil', log),
        'unsafe baseline ref');
    });
  });

  describe('assertNoDotStorybookChange()', () => {
    it('throws when a changed path lives under .storybook', () => {
      expect(() => assertNoDotStorybookChange(['src/a.js', '.storybook/preview.js']))
        .toThrowMatching(e => e instanceof IntelliStoryBailError && e.message.includes('.storybook'));
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
        .toThrowMatching(e => e instanceof IntelliStoryBailError && e.message.includes('yarn.lock'));
    });

    it('bails on an exact (non-glob) pattern match', () => {
      expect(() => assertNoBailOnChanges(['config/settings.js'], ['config/settings.js'])).toThrow();
    });

    it('does not bail when nothing matches', () => {
      expect(() => assertNoBailOnChanges(['src/index.js'], ['*.css'])).not.toThrow();
    });

    it('treats an over-long glob as non-matching instead of throwing', () => {
      expect(() => assertNoBailOnChanges(['yarn.lock'], ['*'.repeat(600)])).not.toThrow();
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

    it('warns with an empty sample when given no snapshots at all', () => {
      let log = mockLog();
      expect(extractStorybookPaths([], identity, log)).toEqual([]);
      expect(log.warn).toHaveBeenCalledTimes(1);
    });
  });

  describe('runGraphGeneration()', () => {
    it('starts the job and resolves once the graph is done', async () => {
      let log = mockLog();
      let generate = jasmine.createSpy('generateIntelliStoryGraph');
      let data = { affected_stories: ['src/A.stories.js'] };
      let percy = {
        client: {
          generateIntelliStoryGraph: generate,
          getStatus: async () => ({ status: 'done', data })
        }
      };

      let payload = {
        files: ['f'],
        modules: [{ id: 0 }],
        storybookPaths: ['p'],
        affectedNodes: ['a'],
        affectedFileLocations: { 0: [[3, 3], [6, 7]] }
      };

      // selection is server-side now, so nothing is returned — it just
      // enqueues generation and resolves once the job reaches `done`.
      await runGraphGeneration(percy, 'bld-1', payload, log);

      expect(generate).toHaveBeenCalledWith('bld-1', payload);
    });

    it('bails when the job does not reach done', async () => {
      let log = mockLog();
      let percy = {
        client: {
          generateIntelliStoryGraph: async () => {},
          getStatus: async () => ({ status: 'failed' })
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

  describe('writeIntelliStoryTrace()', () => {
    beforeEach(() => jasmine.clock().install());
    afterEach(() => jasmine.clock().uninstall());

    const fullData = {
      affected_stories: [],
      vertices: [{ kind: 'component', file_path: 'A.jsx' }],
      edges: [],
      transitive_closure_matrix_sparse: []
    };

    // Flush microtasks between clock ticks so the poll loop advances.
    async function drainPolls(promise, rounds = 20) {
      for (let i = 0; i < rounds; i++) {
        await Promise.resolve();
        await Promise.resolve();
        jasmine.clock().tick(5000);
      }
      return promise;
    }

    it('is a no-op when trace is disabled (defaults its logger and config)', async () => {
      let getStatus = jasmine.createSpy('getStatus');
      // no config and no log arg — exercises `intelliStoryConfig || {}` and the default logger param
      await writeIntelliStoryTrace({ build: { id: '1' }, client: { getStatus } });
      expect(getStatus).not.toHaveBeenCalled();
    });

    it('is a no-op when the Percy build was never created', async () => {
      let log = mockLog();
      let getStatus = jasmine.createSpy('getStatus');
      await writeIntelliStoryTrace({ client: { getStatus } }, { trace: true }, log);
      expect(getStatus).not.toHaveBeenCalled();
    });

    it('skips the trace when the graph reports failed', async () => {
      let log = mockLog();
      let write = spyOn(fs, 'writeFileSync');
      let percy = { build: { id: '1' }, client: { getStatus: async () => ({ status: 'failed' }) } };
      await writeIntelliStoryTrace(percy, { trace: true }, log);
      expect(write).not.toHaveBeenCalled();
      expect(log.debug).toHaveBeenCalled();
    });

    it('skips the trace when polling times out', async () => {
      let log = mockLog();
      let write = spyOn(fs, 'writeFileSync');
      let percy = { build: { id: '1' }, client: { getStatus: async () => ({ status: 'in_progress' }) } };
      await drainPolls(writeIntelliStoryTrace(percy, { trace: true }, log));
      expect(write).not.toHaveBeenCalled();
    });

    it('fetches the finalized graph data and writes the trace when done', async () => {
      let log = mockLog();
      let write = spyOn(fs, 'writeFileSync');
      let percy = { build: { id: '1' }, client: { getStatus: async () => ({ status: 'done', data: fullData }) } };
      await writeIntelliStoryTrace(percy, { trace: true }, log);
      expect(write).toHaveBeenCalledTimes(1);
    });
  });

  describe('runGraphGeneration() polling', () => {
    beforeEach(() => jasmine.clock().install());
    afterEach(() => jasmine.clock().uninstall());

    async function drainPolls(promise, rounds = 20) {
      for (let i = 0; i < rounds; i++) {
        await Promise.resolve();
        await Promise.resolve();
        jasmine.clock().tick(5000);
      }
      return promise;
    }

    it('retries while in_progress and resolves once the job is done', async () => {
      let log = mockLog();
      let data = { affected_stories: [] };
      let seq = ['in_progress', 'in_progress', 'done'];
      let i = 0;
      let percy = {
        client: {
          generateIntelliStoryGraph: async () => {},
          getStatus: async () => {
            let s = seq[Math.min(i++, seq.length - 1)];
            return s === 'done' ? { status: 'done', data } : { status: s };
          }
        }
      };

      let p = runGraphGeneration(percy, 'bld-1', { files: [], modules: [], storybookPaths: [], affectedNodes: [] }, log);
      await expectAsync(drainPolls(p)).toBeResolved();
    });

    it('bails after the poll loop times out without reaching done', async () => {
      let log = mockLog();
      let percy = {
        client: {
          generateIntelliStoryGraph: async () => {},
          getStatus: async () => ({ status: 'in_progress' })
        }
      };

      let p = runGraphGeneration(percy, 'bld-1', { files: [], modules: [], storybookPaths: [], affectedNodes: [] }, log);
      let err;
      await drainPolls(p).catch(e => { err = e; });
      expect(err).toBeInstanceOf(IntelliStoryBailError);
      expect(err.message).toContain('did not complete');
    });
  });

  describe('getAffectedPackages() lockfile diff', () => {
    let origCwd = process.cwd();
    let repos = [];
    afterEach(() => {
      process.chdir(origCwd);
      for (let d of repos.splice(0)) fs.rmSync(d, { recursive: true, force: true });
    });

    it('reads both lockfile sides and runs the diff (bails on Node <18 where snyk is unavailable)', async () => {
      let log = mockLog();
      let { dir, baseSha } = makeRepo(
        {
          'pkg/package.json': JSON.stringify({ name: 'x', dependencies: { 'left-pad': '^1.0.0' } }),
          'pkg/yarn.lock': 'left-pad@^1.0.0:\n  version "1.1.0"\n'
        },
        { 'pkg/yarn.lock': 'left-pad@^1.0.0:\n  version "1.2.0"\n' });
      repos.push(dir);
      process.chdir(dir);

      let res;
      try {
        res = await getAffectedPackages(['pkg/yarn.lock'], baseSha, dir, log);
      } catch (e) {
        res = e;
      }

      if (NODE_MAJOR >= 18) {
        expect(res).toBeDefined();
      } else {
        expect(res).toBeInstanceOf(IntelliStoryBailError);
        expect(res.message).toContain('snyk-nodejs-lockfile-parser is not available');
      }
    });

    it('returns [] when only package.json (no lockfile content) changed', async () => {
      let log = mockLog();
      let { dir, baseSha } = makeRepo(
        { 'pkg/package.json': '{"name":"x"}', 'pkg/yarn.lock': 'left-pad@^1.0.0:\n  version "1.1.0"\n' },
        { 'pkg/package.json': '{"name":"x","version":"2.0.0"}' });
      repos.push(dir);
      process.chdir(dir);

      expect(await getAffectedPackages(['pkg/package.json'], baseSha, dir, log)).toEqual([]);
    });

    it('bails when the lockfile was not tracked at the base ref', async () => {
      let log = mockLog();
      let { dir, baseSha } = makeRepo(
        { 'pkg/package.json': '{"name":"x"}' },
        { 'pkg/yarn.lock': 'left-pad@^1.0.0:\n  version "1.2.0"\n' });
      repos.push(dir);
      process.chdir(dir);

      await expectBail(
        () => getAffectedPackages(['pkg/yarn.lock'], baseSha, dir, log),
        'not present at base ref');
    });

    it('handles a lockfile at the repo root (manifestDir ".")', async () => {
      let log = mockLog();
      let { dir, baseSha } = makeRepo(
        { 'package.json': JSON.stringify({ name: 'x', dependencies: {} }), 'yarn.lock': 'a:\n  version "1.0.0"\n' },
        { 'yarn.lock': 'a:\n  version "2.0.0"\n' });
      repos.push(dir);
      process.chdir(dir);

      let res;
      try {
        res = await getAffectedPackages(['yarn.lock'], baseSha, dir, log);
      } catch (e) {
        res = e;
      }
      if (NODE_MAJOR >= 18) expect(res).toBeDefined();
      else expect(res).toBeInstanceOf(IntelliStoryBailError);
    });
  });

  describe('getAffectedFileLocations()', () => {
    let origCwd = process.cwd();
    let repos = [];
    afterEach(() => {
      process.chdir(origCwd);
      for (let d of repos.splice(0)) fs.rmSync(d, { recursive: true, force: true });
    });

    function setup(seed, changed) {
      let info = makeRepo(seed, changed);
      repos.push(info.dir);
      process.chdir(info.dir);
      return info;
    }

    it('maps changed line ranges to file index, skipping unindexed and deleted files', () => {
      let { dir, baseSha } = setup(
        {
          'src/A.js': 'a\nb\nc\nd\ne\n',
          'src/del.js': 'x\n'
        },
        {
          'src/A.js': 'a\nb\nC\nd\ne\nf\ng\n',
          'src/B.js': 'new\n'
        });

      fs.rmSync(path.join(dir, 'src/del.js'));
      git(['add', '-A'], dir);
      git(['commit', '-qm', 'remove del'], dir);

      let res = getAffectedFileLocations(baseSha, ['src/A.js', 'src/del.js']);

      expect(res).toEqual({ 0: [[3, 3], [6, 7]] });
    });

    it('ignores pure-deletion hunks that add no new lines', () => {
      let { baseSha } = setup(
        { 'src/A.js': '1\n2\n3\n' },
        { 'src/A.js': '1\n3\n' });

      expect(getAffectedFileLocations(baseSha, ['src/A.js'])).toEqual({});
    });

    it('returns an empty map when there is no diff', () => {
      let { baseSha } = setup({ 'src/A.js': 'a\n' });

      expect(getAffectedFileLocations(baseSha, ['src/A.js'])).toEqual({});
    });

    it('bails on an unsafe base ref before shelling out to git', () => {
      expect(() => getAffectedFileLocations('--upload-pack=evil', []))
        .toThrowMatching(e => e instanceof IntelliStoryBailError && e.message.includes('unsafe baseline ref'));
    });
  });

  describe('applyIntelliStory() [integration]', () => {
    let origCwd = process.cwd();
    let repos = [];
    afterEach(() => {
      process.chdir(origCwd);
      for (let d of repos.splice(0)) fs.rmSync(d, { recursive: true, force: true });
    });

    function setup(seed, changed) {
      let info = makeRepo(seed, changed);
      repos.push(info.dir);
      process.chdir(info.dir);
      return info;
    }

    const STATS = JSON.stringify({ buildId: 'bld-1', modules: [] });

    it('bails when no build directory is provided', async () => {
      await expectBail(
        () => applyIntelliStory({ client: {} }, [], undefined, undefined),
        'requires the Storybook build directory');
    });

    it('bails when the Percy build has not been created', async () => {
      let { dir } = setup({ 'sb/enriched-stats.json': STATS, 'src/A.stories.jsx': 'v1' });
      await expectBail(
        () => applyIntelliStory({ client: {} }, [{ name: 'A', importPath: 'src/A.stories.jsx' }],
          { baseline: 'HEAD' }, path.join(dir, 'sb')),
        'Percy build was not created');
    });

    it('bails when nothing is affected after filtering', async () => {
      let { dir } = setup({ 'sb/enriched-stats.json': STATS, 'src/A.stories.jsx': 'v1' });
      await expectBail(
        () => applyIntelliStory(
          { client: { getIntelliStorySnapshotNameToCommit: async () => ({}) }, build: { id: '123' } },
          [{ name: 'A', importPath: 'src/A.stories.jsx' }],
          { baseline: 'HEAD' }, path.join(dir, 'sb')),
        'no affected files or packages detected');
    });

    itPosix('tags every snapshot for server-side selection and enqueues graph generation against the Percy build id', async () => {
      let { dir, baseSha } = setup(
        { 'sb/enriched-stats.json': STATS, 'src/A.stories.jsx': 'v1' },
        { 'src/A.stories.jsx': 'v2' });

      let generate = jasmine.createSpy('generateIntelliStoryGraph');
      let percy = {
        build: { id: '456' },
        client: {
          generateIntelliStoryGraph: generate,
          // job status no longer returns affected_stories during the run
          getStatus: async () => ({ status: 'done', data: {} }),
          // an explicit baseline is set, but the base lookup is always called
          // now (to surface browser_upgrade)
          getIntelliStorySnapshotNameToCommit: async () => ({})
        }
      };
      let snapshots = [
        { name: 'A', importPath: 'src/A.stories.jsx' },
        { name: 'Dot', importPath: './src/Dot.stories.jsx' },
        { name: 'NoPath' },
        { name: 'Empty', importPath: '' }
      ];

      let result = await applyIntelliStory(percy, snapshots, { baseline: baseSha, trace: false }, path.join(dir, 'sb'));

      // all snapshots are returned (the API performs selection when they post)
      expect(result.map(s => s.name).sort()).toEqual(['A', 'Dot', 'Empty', 'NoPath']);
      // each is tagged for IntelliStory with its normalized storybook path
      expect(result.every(s => s.intelliStory === true)).toBe(true);
      expect(result.find(s => s.name === 'A').storybookPath).toEqual(path.join('src', 'A.stories.jsx'));
      expect(result.find(s => s.name === 'Dot').storybookPath).toEqual(path.join('src', 'Dot.stories.jsx'));
      // the graph is enqueued against the real Percy build id, not the stats UUID
      expect(generate).toHaveBeenCalledWith('456', jasmine.any(Object));
    });

    itPosix('disables IntelliStory for snapshots with a missing/failed/rejected baseline so they are always captured', async () => {
      let { dir, baseSha } = setup(
        { 'sb/enriched-stats.json': STATS, 'src/A.stories.jsx': 'v1' },
        { 'src/A.stories.jsx': 'v2' });

      let percy = {
        build: { id: '789' },
        client: {
          generateIntelliStoryGraph: jasmine.createSpy('generateIntelliStoryGraph'),
          getStatus: async () => ({ status: 'done', data: {} }),
          // no explicit baseline: base commit + per-snapshot states come from the API
          getIntelliStorySnapshotNameToCommit: async () => ({
            base_build_commit_sha: baseSha,
            snapshots: { Approved: 'approved', Failed: 'failed', Rejected: 'rejected' }
          })
        }
      };
      let snapshots = [
        { name: 'Approved', importPath: 'src/A.stories.jsx' },
        { name: 'Failed', importPath: 'src/A.stories.jsx' },
        { name: 'Rejected', importPath: 'src/A.stories.jsx' },
        { name: 'Missing', importPath: 'src/A.stories.jsx' }
      ];

      let result = await applyIntelliStory(percy, snapshots, { trace: false }, path.join(dir, 'sb'));
      let byName = Object.fromEntries(result.map(s => [s.name, s.intelliStory]));

      // approved baseline => IntelliStory selection applies
      expect(byName.Approved).toBe(true);
      // failed / rejected / missing baselines => always captured
      expect(byName.Failed).toBe(false);
      expect(byName.Rejected).toBe(false);
      expect(byName.Missing).toBe(false);
    });
  });
});
