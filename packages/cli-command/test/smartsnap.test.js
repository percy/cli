import fs from 'fs';
import os from 'os';
import path from 'path';
import cp from 'child_process';
import { mockfs } from './helpers.js';
import {
  SmartSnapBailError,
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
  selectAffectedSnapshots,
  applySmartSnap
} from '../src/smartsnap.js';

const NODE_MAJOR = parseInt(process.versions.node.split('.')[0], 10);

// The applySmartSnap happy-path test asserts project-root-relative path matching
// (normalizeImportPath). On Windows `git rev-parse --show-toplevel` (forward-slash,
// drive-letter) and process.cwd() (back-slash) don't reconcile through
// path.relative, so the match is platform-specific. Coverage for that path is
// enforced on the POSIX (ubuntu) CI; on Windows (which runs `test`, not
// `test:coverage`) we skip it rather than assert a platform-dependent result.
const itPosix = path.sep === '/' ? it : xit;

// Run a git command in `cwd`, throwing on non-zero exit. Used to build the
// throwaway repos the integration tests diff against — applySmartSnap and
// getAffectedPackages shell out to real git (spawnSync can't be spied), so the
// only faithful way to exercise their git-driven paths is a real repo.
function git(args, cwd) {
  let r = cp.spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr || r.stdout}`);
  return r.stdout;
}

// Build a throwaway git repo: write+commit `seed` ({ relpath: contents }), then
// (optionally) write+commit `changed`. Returns { dir, baseSha }. realpathSync so
// process.cwd() and `git rev-parse --show-toplevel` agree on macOS (/var vs
// /private/var), keeping path.relative-based normalization byte-stable.
function makeRepo(seed, changed) {
  let dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'smartsnap-')));
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

    it('streams modules: indexes src refs, leaves module refs, drops node_modules/string-id and id-less entries', async () => {
      await mockfs({
        '/build/enriched-stats.json': JSON.stringify({
          buildId: 'b',
          modules: [
            {
              id: '/root/src/A.js',
              imports: [
                { type: 'src', source: '/root/src/B.js', loc: [{ start: 38, end: 38 }, { start: 40, end: 42 }] },
                { type: 'src', source: '/root/src/B.js' }, // duplicate → reuses the existing index
                { type: 'src', source: 'lib/rel.js' }, // non-absolute → returned as-is, not indexed
                { type: 'module', source: 'react' }
              ],
              passThroughExports: [{ type: 'src', source: '/root/src/C.js', loc: [{ start: 5, end: 5 }] }],
              nonPassThroughExports: [{ type: 'module', source: 'lodash' }]
            },
            { id: '/root/node_modules/dep/index.js' }, // excluded → string id → dropped
            {} // no id, no import/export arrays → kept as {}
          ]
        })
      });

      let res = await validateAndReadStats('/build', undefined, '/root', log);

      expect(res.buildId).toEqual('b');
      // Indexed in encounter order; node_modules paths are excluded (not indexed).
      // `path.relative` uses the platform separator (back-slash on Windows).
      expect(res.files).toEqual([path.join('src', 'A.js'), path.join('src', 'B.js'), path.join('src', 'C.js')]);
      expect(res.modules.length).toEqual(2); // the string-id module is dropped
      expect(res.modules[0].id).toEqual(0);
      expect(res.modules[0].imports[0].source).toEqual(1); // src ref → index
      expect(res.modules[0].imports[1].source).toEqual(1); // duplicate → same index
      expect(res.modules[0].imports[2].source).toEqual('lib/rel.js'); // non-absolute → as-is
      expect(res.modules[0].imports[3].source).toEqual('react'); // module ref → untouched
      expect(res.modules[0].imports[0].loc).toEqual([[38, 38], [40, 42]]); // {start,end} spans → [start,end] tuples
      expect(res.modules[0].passThroughExports[0].source).toEqual(2);
      expect(res.modules[0].passThroughExports[0].loc).toEqual([[5, 5]]);
      expect(res.modules[0].nonPassThroughExports).toEqual([{ type: 'module', source: 'lodash' }]);
      expect(res.modules[1]).toEqual({});
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

    it('defaults baselineSnapshots to {} when the API omits the snapshot map', async () => {
      let percy = { client: { getSmartsnapSnapshotNameToCommit: async () => ({ base_build_commit_sha: 'HEAD' }) } };
      let res = await getBaselineAndAffectedNodes(percy, undefined, log);
      expect(res.baseRef).toEqual('HEAD');
      expect(res.baselineSnapshots).toEqual({});
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

    it('treats an over-long glob as non-matching instead of throwing', () => {
      // A >500-char glob makes patternToRegex throw; matchesPattern swallows it
      // and reports no match rather than crashing on a bad config value.
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
      // affectedFileLocations is forwarded verbatim; the client snake_cases it.
      let payload = {
        files: ['f'],
        modules: [{ id: 0 }],
        storybookPaths: ['p'],
        affectedNodes: ['a'],
        affectedFileLocations: { 0: [[3, 3], [6, 7]] }
      };

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

    it('treats a payload with no affected_stories field as none affected', () => {
      let log = mockLog();
      let snapshots = [{ name: 'A', importPath: 'src/A.stories.js' }];
      // data.affected_stories is undefined → defaults to an empty set.
      expect(selectAffectedSnapshots(snapshots, {}, 'main', null, identity, log)).toEqual([]);
    });
  });

  describe('runGraphGeneration() polling', () => {
    beforeEach(() => jasmine.clock().install());
    afterEach(() => jasmine.clock().uninstall());

    // Drive the async poll loop under fake timers: flush microtasks, then
    // advance one 5s interval, repeat. Extra rounds after the promise settles
    // are harmless, so we over-provision past POLL_ATTEMPTS (12).
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
          generateSmartsnapGraph: async () => {},
          getStatus: async () => {
            let s = seq[Math.min(i++, seq.length - 1)];
            return s === 'done' ? { status: 'done', data } : { status: s };
          }
        }
      };

      let p = runGraphGeneration(percy, 'bld-1', { files: [], modules: [], storybookPaths: [], affectedNodes: [] }, log);
      await expectAsync(drainPolls(p)).toBeResolvedTo(data);
    });

    it('bails after the poll loop times out without reaching done', async () => {
      let log = mockLog();
      let percy = {
        client: {
          generateSmartsnapGraph: async () => {},
          getStatus: async () => ({ status: 'in_progress' })
        }
      };

      let p = runGraphGeneration(percy, 'bld-1', { files: [], modules: [], storybookPaths: [], affectedNodes: [] }, log);
      let err;
      await drainPolls(p).catch(e => { err = e; });
      expect(err).toBeInstanceOf(SmartSnapBailError);
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
        // On Node >=18 snyk loads; whether the diff resolves or surfaces a parse
        // error is incidental — this branch isn't what the Node-14 CI measures.
        expect(res).toBeDefined();
      } else {
        // On Node 14 diffLockfileDeps throws SNYK_LOCKFILE_PARSER_UNAVAILABLE,
        // which getAffectedPackages downgrades to a full-set bail.
        expect(res).toBeInstanceOf(SmartSnapBailError);
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

      // yarn.lock is byte-identical at base and HEAD → short-circuits to [].
      expect(await getAffectedPackages(['pkg/package.json'], baseSha, dir, log)).toEqual([]);
    });

    it('bails when the lockfile was not tracked at the base ref', async () => {
      let log = mockLog();
      let { dir, baseSha } = makeRepo(
        { 'pkg/package.json': '{"name":"x"}' }, // base: no lockfile
        { 'pkg/yarn.lock': 'left-pad@^1.0.0:\n  version "1.2.0"\n' }); // HEAD: lockfile added
      repos.push(dir);
      process.chdir(dir);

      // lockfile exists on disk (HEAD) but `git show <base>:pkg/yarn.lock` fails.
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

      // manifestDir resolves to '.', exercising the root-vs-subdir repo-path branches.
      let res;
      try {
        res = await getAffectedPackages(['yarn.lock'], baseSha, dir, log);
      } catch (e) {
        res = e;
      }
      if (NODE_MAJOR >= 18) expect(res).toBeDefined();
      else expect(res).toBeInstanceOf(SmartSnapBailError);
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
          'src/A.js': 'a\nb\nc\nd\ne\n', // indexed; line 3 changed + lines 6-7 appended
          'src/del.js': 'x\n' // indexed; deleted at HEAD → no new-side lines
        },
        {
          'src/A.js': 'a\nb\nC\nd\ne\nf\ng\n',
          'src/B.js': 'new\n' // NOT in the files index → skipped
        });
      // makeRepo's writeAll can't delete; drop del.js in a follow-up commit so the
      // baseSha→HEAD diff carries its `+++ /dev/null` deletion hunk.
      fs.rmSync(path.join(dir, 'src/del.js'));
      git(['add', '-A'], dir);
      git(['commit', '-qm', 'remove del'], dir);

      // files index: A=0, del=1; B.js is absent (not indexed).
      let res = getAffectedFileLocations(baseSha, ['src/A.js', 'src/del.js']);

      // A.js: `@@ -3 +3 @@` → [3,3] and `@@ -5,0 +6,2 @@` → [6,7].
      // del.js shows `+++ /dev/null` (pure deletion) → no entry. B.js unindexed → no entry.
      expect(res).toEqual({ 0: [[3, 3], [6, 7]] });
    });

    it('ignores pure-deletion hunks that add no new lines', () => {
      let { baseSha } = setup(
        { 'src/A.js': '1\n2\n3\n' }, // line 2 removed, file kept
        { 'src/A.js': '1\n3\n' });
      // `@@ -2 +1,0 @@` → new-side count 0 → no range contributed.
      expect(getAffectedFileLocations(baseSha, ['src/A.js'])).toEqual({});
    });

    it('returns an empty map when there is no diff', () => {
      let { baseSha } = setup({ 'src/A.js': 'a\n' });
      // baseSha === HEAD (no second commit) → `git diff <sha> HEAD` is empty.
      expect(getAffectedFileLocations(baseSha, ['src/A.js'])).toEqual({});
    });

    it('bails on an unsafe base ref before shelling out to git', () => {
      expect(() => getAffectedFileLocations('--upload-pack=evil', []))
        .toThrowMatching(e => e instanceof SmartSnapBailError && e.message.includes('unsafe baseline ref'));
    });
  });

  describe('applySmartSnap() [integration]', () => {
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
      // pass an undefined config too, exercising the `smartSnapConfig || {}` guard.
      await expectBail(
        () => applySmartSnap({ client: {} }, [], undefined, undefined),
        'requires the Storybook build directory');
    });

    it('bails when nothing is affected after filtering', async () => {
      // baseline=HEAD → `git diff HEAD HEAD` is empty, no manifest changes, so
      // both affectedNodes and packageAffectedNodes are empty.
      let { dir } = setup({ 'sb/enriched-stats.json': STATS, 'src/A.stories.jsx': 'v1' });
      await expectBail(
        () => applySmartSnap({ client: {} }, [{ name: 'A', importPath: 'src/A.stories.jsx' }],
          { baseline: 'HEAD' }, path.join(dir, 'sb')),
        'no affected files or packages detected');
    });

    itPosix('keeps only the snapshots the affected-graph reports', async () => {
      let { dir, baseSha } = setup(
        { 'sb/enriched-stats.json': STATS, 'src/A.stories.jsx': 'v1' },
        { 'src/A.stories.jsx': 'v2' });

      // affected_stories arrive already in the project-root frame; normalizeImportPath
      // produces the platform separator, so match it with path.join (back-slash on Windows).
      let data = { affected_stories: [path.join('src', 'A.stories.jsx'), path.join('src', 'Dot.stories.jsx')] };
      let generate = jasmine.createSpy('generateSmartsnapGraph');
      let percy = {
        client: {
          generateSmartsnapGraph: generate,
          getStatus: async () => ({ status: 'done', data })
        }
      };
      let snapshots = [
        { name: 'A', importPath: 'src/A.stories.jsx' }, // plain → kept
        { name: 'Dot', importPath: './src/Dot.stories.jsx' }, // ./ prefix stripped → kept
        { name: 'NoPath' }, // undefined importPath → dropped
        { name: 'Empty', importPath: '' } // empty importPath → dropped
      ];

      let result = await applySmartSnap(percy, snapshots, { baseline: baseSha, trace: false }, path.join(dir, 'sb'));

      expect(result.map(s => s.name).sort()).toEqual(['A', 'Dot']);
      expect(generate).toHaveBeenCalled();
    });
  });
});
