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
  resolveConfigDirs,
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

    it('bails when the stats file contains malformed JSON', async () => {
      await mockfs({ '/build/enriched-stats.json': '{ not valid json' });
      await expectBail(
        () => validateAndReadStats('/build', undefined, '/root', log),
        'failed to parse stats file');
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

    it('excludes modules inside a custom config directory from the graph', async () => {
      await mockfs({
        '/build/enriched-stats.json': JSON.stringify({
          modules: [{ id: '/root/src/A.js' }, { id: '/root/config/storybook/preview.js' }]
        })
      });

      let res = await validateAndReadStats('/build', undefined, '/root', log,
        ['.storybook', 'config/storybook']);

      expect(res.files).toEqual([path.join('src', 'A.js')]);
      expect(res.modules.length).toEqual(1);
    });

    it('warns when a minority of modules have unresolved ids', async () => {
      let warnLog = mockLog();
      await mockfs({
        '/build/enriched-stats.json': JSON.stringify({
          modules: [
            ...Array.from({ length: 19 }, (_, i) => ({ id: `/root/src/${i}.js` })),
            { id: 'virtual:synthetic-module' }
          ]
        })
      });

      let res = await validateAndReadStats('/build', undefined, '/root', warnLog);

      expect(res.modules.length).toEqual(19);
      expect(warnLog.warn).toHaveBeenCalledOnceWith(
        jasmine.stringMatching(/dropped 1 of 20 module\(s\) with unresolved/));
    });

    it('bails when too many modules have unresolved ids', async () => {
      await mockfs({
        '/build/enriched-stats.json': JSON.stringify({
          modules: [
            { id: '/root/src/A.js' },
            { id: '/root/src/B.js' },
            { id: 'virtual:one' },
            { id: 'virtual:two' }
          ]
        })
      });

      await expectBail(
        () => validateAndReadStats('/build', undefined, '/root', log),
        '2 of 4 stats modules have unresolved (non-absolute) ids (50%, limit 10%)');
    });

    // deliberately excluded modules are not a graph gap, so they must not push
    // a healthy build over the threshold
    it('does not count excluded modules towards the unresolved ratio', async () => {
      let warnLog = mockLog();
      await mockfs({
        '/build/enriched-stats.json': JSON.stringify({
          modules: [
            ...Array.from({ length: 20 }, (_, i) => ({ id: `/root/node_modules/dep${i}/index.js` })),
            ...Array.from({ length: 19 }, (_, i) => ({ id: `/root/src/${i}.js` })),
            { id: 'virtual:synthetic-module' }
          ]
        })
      });

      let res = await validateAndReadStats('/build', undefined, '/root', warnLog);

      expect(res.modules.length).toEqual(19);
      // 1/20 candidates, not 21/40 raw
      expect(warnLog.warn).toHaveBeenCalledOnceWith(
        jasmine.stringMatching(/dropped 1 of 20 module\(s\)/));
    });
  });

  describe('getBaselineAndAffectedNodes()', () => {
    const log = mockLog();

    it('uses an explicit baseline but still calls the API to check for a browser upgrade', async () => {
      let lookup = jasmine.createSpy('getIntelliStorySnapshotNameToCommit')
        .and.resolveTo({ browsers_changed_from_base: false });
      let percy = { client: { getIntelliStorySnapshotNameToCommit: lookup } };

      let res = await getBaselineAndAffectedNodes(percy, 'HEAD', log);

      expect(res.baseRef).toEqual('HEAD');
      expect(res.affectedNodes).toEqual([]);
      expect(lookup).toHaveBeenCalled();
    });

    it('tolerates the API returning no base lookup when an explicit baseline is set', async () => {
      let percy = { client: { getIntelliStorySnapshotNameToCommit: async () => undefined } };

      let res = await getBaselineAndAffectedNodes(percy, 'HEAD', log);

      expect(res.baseRef).toEqual('HEAD');
    });

    it('bails when the base lookup reports a browser upgrade, even with an explicit baseline', async () => {
      let percy = {
        client: {
          getIntelliStorySnapshotNameToCommit: async () => ({
            browsers_changed_from_base: true,
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
          getIntelliStorySnapshotNameToCommit: async () => ({ base_build_commit_sha: 'HEAD' })
        }
      };

      let res = await getBaselineAndAffectedNodes(percy, undefined, log);

      expect(res.baseRef).toEqual('HEAD');
      expect(res.affectedNodes).toEqual([]);
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

    it('throws when a changed path lives under a custom config directory', () => {
      expect(() => assertNoDotStorybookChange(['config/storybook/main.js'], ['config/storybook']))
        .toThrowMatching(e => e instanceof IntelliStoryBailError &&
          e.message.includes('config/storybook/main.js'));
    });

    it('does not confuse a custom config directory with a similarly named sibling', () => {
      expect(() => assertNoDotStorybookChange(['config/storybook-old/main.js'], ['config/storybook']))
        .not.toThrow();
    });

    it('still recognises .storybook when a custom directory is configured', () => {
      expect(() => assertNoDotStorybookChange(['.storybook/preview.js'], ['.storybook', 'config/storybook']))
        .toThrow();
    });

    it('matches a single-segment custom directory at any depth', () => {
      expect(() => assertNoDotStorybookChange(['packages/ui/sbconfig/main.js'], ['sbconfig']))
        .toThrow();
    });
  });

  describe('resolveConfigDirs()', () => {
    it('returns just the default when no configDir is set', () => {
      expect(resolveConfigDirs(undefined, '/repo', '/repo')).toEqual(['.storybook']);
      expect(resolveConfigDirs('.storybook', '/repo', '/repo')).toEqual(['.storybook']);
    });

    it('keeps the default alongside a custom directory', () => {
      expect(resolveConfigDirs('config/storybook', '/repo', '/repo'))
        .toEqual(['.storybook', 'config/storybook']);
    });

    it('rebases a custom directory from the invocation directory', () => {
      expect(resolveConfigDirs('config/storybook', '/repo', '/repo/packages/ui'))
        .toEqual(['.storybook', 'packages/ui/config/storybook']);
    });

    it('does not warn when the resolved directory exists', async () => {
      let log = mockLog();
      await mockfs({ '/repo/packages/ui/config/storybook/main.js': 'x' });

      resolveConfigDirs('config/storybook', '/repo', '/repo/packages/ui', log);
      expect(log.warn).not.toHaveBeenCalled();
    });

    // over-recognising a config directory costs snapshots; missing the real one
    // loses comparisons, so a directory that only exists on the repo-root basis
    // is recognised too rather than silently matching nothing
    it('also recognises a directory that only exists relative to the project root', async () => {
      let log = mockLog();
      await mockfs({ '/repo/packages/ui/config/storybook/main.js': 'x' });

      expect(resolveConfigDirs('packages/ui/config/storybook', '/repo', '/repo/packages/ui', log))
        .toEqual(['.storybook', 'packages/ui/config/storybook', 'packages/ui/packages/ui/config/storybook']);
      expect(log.warn).toHaveBeenCalledOnceWith(
        jasmine.stringMatching(/does but does relative to the project root|but does relative to the project root; recognising both/));
    });

    it('warns when the directory does not exist on either basis', async () => {
      let log = mockLog();
      await mockfs({ '/repo/packages/ui/src/a.js': 'x' });

      resolveConfigDirs('config/storybook', '/repo', '/repo/packages/ui', log);
      expect(log.warn).toHaveBeenCalledOnceWith(
        jasmine.stringMatching(/which does not exist/));
    });

    it('warns and falls back when the configDir escapes the project root', () => {
      let log = mockLog();
      expect(resolveConfigDirs('../../../elsewhere', '/repo', '/repo/packages/ui', log))
        .toEqual(['.storybook']);
      expect(log.warn).toHaveBeenCalledOnceWith(
        jasmine.stringMatching(/resolves outside the project root/));
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

    it('bails when a changed file matches a brace-expansion glob', () => {
      expect(() => assertNoBailOnChanges(['src/b.js'], ['src/{a,b}.js']))
        .toThrowMatching(e => e instanceof IntelliStoryBailError && e.message.includes('src/b.js'));
    });

    it('bails when a changed file matches a bracket-set glob', () => {
      expect(() => assertNoBailOnChanges(['src/a.ts'], ['src/a.[jt]s']))
        .toThrowMatching(e => e instanceof IntelliStoryBailError && e.message.includes('src/a.ts'));
    });

    it('does not bail when nothing matches', () => {
      expect(() => assertNoBailOnChanges(['src/index.js'], ['*.css'])).not.toThrow();
    });

    it('bails on an over-long glob rather than silently disabling the pattern', () => {
      expect(() => assertNoBailOnChanges(['yarn.lock'], ['*'.repeat(600)]))
        .toThrowMatching(e => e instanceof IntelliStoryBailError && e.message.includes('not a valid glob'));
    });

    it('bails on a malformed glob rather than silently disabling the pattern', () => {
      expect(() => assertNoBailOnChanges(['src/a.js'], ['src/[']))
        .toThrowMatching(e => e instanceof IntelliStoryBailError && e.message.includes('not a valid glob'));
    });

    describe('when invoked from a subdirectory of the project root', () => {
      const opts = (log) => ({
        projectRoot: '/repo', invocationDir: '/repo/packages/ui', log
      });

      it('rebases an invocation-relative pattern onto the repo root', () => {
        expect(() => assertNoBailOnChanges(
          ['packages/ui/webpack.config.js'], ['webpack.config.js'], opts()))
          .toThrowMatching(e => e.message.includes('packages/ui/webpack.config.js'));
      });

      it('rebases invocation-relative globs onto the repo root', () => {
        expect(() => assertNoBailOnChanges(
          ['packages/ui/src/theme.css'], ['src/**/*.css'], opts()))
          .toThrowMatching(e => e.message.includes('packages/ui/src/theme.css'));
      });

      it('does not match a sibling package that shares the pattern', () => {
        expect(() => assertNoBailOnChanges(
          ['packages/api/webpack.config.js'], ['webpack.config.js'], opts())).not.toThrow();
      });

      it('honours <rootDir>/ as a repo-root anchor without warning', () => {
        let log = mockLog();
        expect(() => assertNoBailOnChanges(
          ['packages/api/webpack.config.js'], ['<rootDir>/packages/api/webpack.config.js'], opts(log)))
          .toThrowMatching(e => e.message.includes('packages/api/webpack.config.js'));
        expect(log.warn).not.toHaveBeenCalled();
      });

      it('still bails, with a warning, on a pattern written relative to the repo root', () => {
        let log = mockLog();
        expect(() => assertNoBailOnChanges(
          ['packages/ui/webpack.config.js'], ['packages/ui/webpack.config.js'], opts(log)))
          .toThrowMatching(e => e.message.includes('packages/ui/webpack.config.js'));
        expect(log.warn).toHaveBeenCalledOnceWith(
          jasmine.stringMatching(/only when read relative to the project root/));
        // the advice re-spells it against the invocation directory
        expect(log.warn.calls.argsFor(0)[0]).toContain('"webpack.config.js"');
      });

      it('bails on a pattern that resolves outside the project root', () => {
        expect(() => assertNoBailOnChanges(['src/a.js'], ['../../../etc/passwd'], opts()))
          .toThrowMatching(e => e.message.includes('resolves outside the project root'));
      });

      it('rebases an absolute pattern inside the project root', () => {
        expect(() => assertNoBailOnChanges(
          ['packages/ui/webpack.config.js'], ['/repo/packages/ui/webpack.config.js'], opts()))
          .toThrowMatching(e => e.message.includes('packages/ui/webpack.config.js'));
      });
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

    it('drops paths matching a brace-expansion glob', () => {
      let nodes = ['src/a.js', 'src/b.js', 'src/c.js'];
      expect(enforceUntraced(nodes, ['src/{a,b}.js'])).toEqual(['src/c.js']);
    });

    it('drops paths matching a bracket-set glob', () => {
      let nodes = ['docs/a.md', 'docs/b.md', 'src/a.js'];
      expect(enforceUntraced(nodes, ['docs/[ab].md'])).toEqual(['src/a.js']);
    });

    it('ignores a malformed glob with a warning instead of silently', () => {
      let log = mockLog();
      let nodes = ['src/a.js'];
      expect(enforceUntraced(nodes, ['src/['], { log })).toEqual(nodes);
      expect(log.warn).toHaveBeenCalledOnceWith(
        jasmine.stringMatching(/not a valid glob/));
    });

    describe('when invoked from a subdirectory of the project root', () => {
      const opts = (log) => ({
        projectRoot: '/repo', invocationDir: '/repo/packages/ui', log
      });

      it('rebases an invocation-relative pattern onto the repo root', () => {
        let nodes = ['packages/ui/tsconfig.json', 'packages/ui/src/a.js'];
        expect(enforceUntraced(nodes, ['tsconfig.json'], opts()))
          .toEqual(['packages/ui/src/a.js']);
      });

      it('does not untrace the same filename in a sibling package', () => {
        let nodes = ['packages/api/tsconfig.json', 'packages/ui/src/a.js'];
        expect(enforceUntraced(nodes, ['tsconfig.json'], opts())).toEqual(nodes);
      });

      it('honours <rootDir>/ as a repo-root anchor without warning', () => {
        let log = mockLog();
        let nodes = ['packages/api/tsconfig.json', 'packages/ui/src/a.js'];
        expect(enforceUntraced(nodes, ['<rootDir>/packages/api/tsconfig.json'], opts(log)))
          .toEqual(['packages/ui/src/a.js']);
        expect(log.warn).not.toHaveBeenCalled();
      });

      // the opposite policy to bailOnChanges, and deliberately so: applying an
      // ambiguous untraced pattern would drop snapshots, so it is reported and
      // left unapplied rather than guessed at
      it('warns but does not apply a pattern written relative to the repo root', () => {
        let log = mockLog();
        let nodes = ['packages/ui/tsconfig.json', 'packages/ui/src/a.js'];
        expect(enforceUntraced(nodes, ['packages/ui/tsconfig.json'], opts(log))).toEqual(nodes);
        expect(log.warn).toHaveBeenCalledOnceWith(
          jasmine.stringMatching(/only when read relative to the project root/));
      });

      it('ignores a pattern that resolves outside the project root, with a warning', () => {
        let log = mockLog();
        let nodes = ['packages/ui/src/a.js'];
        expect(enforceUntraced(nodes, ['../../../etc/passwd'], opts(log))).toEqual(nodes);
        expect(log.warn).toHaveBeenCalledOnceWith(
          jasmine.stringMatching(/resolves outside the project root/));
      });
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

    it('bails when the current lockfile cannot be read', async () => {
      let log = mockLog();
      let { dir, baseSha } = makeRepo(
        { 'pkg/package.json': '{"name":"x"}', 'pkg/yarn.lock': 'a:\n  version "1.0.0"\n' },
        { 'pkg/yarn.lock': 'a:\n  version "2.0.0"\n' });
      repos.push(dir);
      process.chdir(dir);

      spyOn(fs, 'readFileSync').and.throwError('EIO');
      await expectBail(
        () => getAffectedPackages(['pkg/yarn.lock'], baseSha, dir, log),
        'failed to read lockfile');
    });

    it('bails when package.json cannot be read', async () => {
      let log = mockLog();
      let { dir, baseSha } = makeRepo(
        { 'pkg/package.json': '{"name":"x"}', 'pkg/yarn.lock': 'a:\n  version "1.0.0"\n' },
        { 'pkg/yarn.lock': 'a:\n  version "2.0.0"\n' });
      repos.push(dir);
      process.chdir(dir);

      let realRead = fs.readFileSync;
      spyOn(fs, 'readFileSync').and.callFake((p, ...rest) => {
        if (String(p).endsWith('package.json')) throw new Error('EIO');
        return realRead(p, ...rest);
      });
      await expectBail(
        () => getAffectedPackages(['pkg/yarn.lock'], baseSha, dir, log),
        'failed to read "package.json"');
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
          // now (to surface browsers_changed_from_base)
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
      // each resolvable story is tagged with its normalized storybook path
      expect(result.find(s => s.name === 'A')).toEqual(jasmine.objectContaining({
        intelliStory: true, storybookPath: path.join('src', 'A.stories.jsx')
      }));
      expect(result.find(s => s.name === 'Dot')).toEqual(jasmine.objectContaining({
        intelliStory: true, storybookPath: path.join('src', 'Dot.stories.jsx')
      }));
      // stories with no resolvable source path stay untagged — the API rejects
      // `intelli-story` without a `storybook-path`, so they are captured as normal
      expect(result.find(s => s.name === 'NoPath').intelliStory).toBe(false);
      expect(result.find(s => s.name === 'Empty').intelliStory).toBe(false);
      // the graph is enqueued against the real Percy build id, not the stats UUID
      expect(generate).toHaveBeenCalledWith('456', jasmine.any(Object));
    });

    itPosix('tags every snapshot when the base commit comes from the API rather than an explicit baseline', async () => {
      let { dir, baseSha } = setup(
        { 'sb/enriched-stats.json': STATS, 'src/A.stories.jsx': 'v1' },
        { 'src/A.stories.jsx': 'v2' });

      let percy = {
        build: { id: '789' },
        client: {
          generateIntelliStoryGraph: jasmine.createSpy('generateIntelliStoryGraph'),
          getStatus: async () => ({ status: 'done', data: {} }),
          // no explicit baseline: the base commit comes from the API
          getIntelliStorySnapshotNameToCommit: async () => ({ base_build_commit_sha: baseSha })
        }
      };
      let snapshots = [
        { name: 'A', importPath: 'src/A.stories.jsx' },
        { name: 'B', importPath: 'src/A.stories.jsx' }
      ];

      let result = await applyIntelliStory(percy, snapshots, { trace: false }, path.join(dir, 'sb'));

      // baseline eligibility is the API's call now — the CLI tags everything
      expect(result.every(s => s.intelliStory === true)).toBe(true);
    });

    // `git diff --name-only` emits repo-root-relative paths whatever the cwd, so
    // a monorepo invocation is the case where an un-rebased user pattern would
    // silently match nothing
    describe('invoked from a nested package directory', () => {
      function setupNested(seed, changed) {
        let info = makeRepo(seed, changed);
        repos.push(info.dir);
        // two relative steps rather than a path.join of the temp dir: semgrep's
        // path-join-resolve-traversal rule treats the helper's argument as user
        // input, and inline `// nosemgrep` is not honored by the CI semgrep version
        process.chdir(info.dir);
        process.chdir('packages/ui');
        return info;
      }

      function percyStub() {
        return {
          build: { id: '456' },
          client: {
            generateIntelliStoryGraph: jasmine.createSpy('generateIntelliStoryGraph'),
            getStatus: async () => ({ status: 'done', data: {} }),
            getIntelliStorySnapshotNameToCommit: async () => ({})
          }
        };
      }

      itPosix('bails on a bailOnChanges pattern relative to the invocation directory', async () => {
        let { dir, baseSha } = setupNested(
          {
            'packages/ui/sb/enriched-stats.json': STATS,
            'packages/ui/src/A.stories.jsx': 'v1',
            'packages/ui/webpack.config.js': 'v1'
          },
          { 'packages/ui/webpack.config.js': 'v2' });

        await expectBail(
          () => applyIntelliStory(
            percyStub(),
            [{ name: 'A', importPath: 'src/A.stories.jsx' }],
            { baseline: baseSha, bailOnChanges: ['webpack.config.js'], trace: false },
            path.join(dir, 'packages/ui/sb')),
          'change to "packages/ui/webpack.config.js" matched bailOnChanges');
      });

      itPosix('rebases story paths and user patterns onto the same basis', async () => {
        let { dir, baseSha } = setupNested(
          {
            'packages/ui/sb/enriched-stats.json': STATS,
            'packages/ui/src/A.stories.jsx': 'v1',
            'packages/ui/tsconfig.json': 'v1'
          },
          { 'packages/ui/src/A.stories.jsx': 'v2' });

        let percy = percyStub();
        let result = await applyIntelliStory(
          percy,
          [{ name: 'A', importPath: 'src/A.stories.jsx' }],
          { baseline: baseSha, untraced: ['tsconfig.json'], trace: false },
          path.join(dir, 'packages/ui/sb'));

        // the story path is project-relative...
        expect(result[0].storybookPath).toEqual(path.join('packages/ui/src', 'A.stories.jsx'));
        // ...and so is the affected node the graph job was given
        expect(percy.client.generateIntelliStoryGraph).toHaveBeenCalledWith('456',
          jasmine.objectContaining({ affectedNodes: ['packages/ui/src/A.stories.jsx'] }));
      });

      itPosix('untraces a file matched by an invocation-relative pattern', async () => {
        let { dir, baseSha } = setupNested(
          {
            'packages/ui/sb/enriched-stats.json': STATS,
            'packages/ui/src/A.stories.jsx': 'v1',
            'packages/ui/tsconfig.json': 'v1'
          },
          { 'packages/ui/tsconfig.json': 'v2' });

        // the only changed file is untraced, so nothing is left to trace
        await expectBail(
          () => applyIntelliStory(
            percyStub(),
            [{ name: 'A', importPath: 'src/A.stories.jsx' }],
            { baseline: baseSha, untraced: ['tsconfig.json'], trace: false },
            path.join(dir, 'packages/ui/sb')),
          'no affected files or packages detected');
      });
    });
  });
});
