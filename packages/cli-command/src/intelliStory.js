import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { createRequire } from 'module';
import globToRegExp from 'glob-to-regexp';
import logger from '@percy/logger';
import { diffLockfileDeps } from './lockfileDiff.js';
import { renderGraphTraceHtml } from './graphTrace.js';

// stream-json is CommonJS — load via createRequire to avoid named-import interop issues.
// Bound to a non-`require` name on purpose: in the CommonJS-transpiled binary,
// naming it `require` collides with Babel's preset-env + transform-import-meta,
// which rewrite `import.meta.url` into a `require('url')` call that then gets
// renamed alongside the local binding to `_require(...)` inside its own
// initializer (TypeError: _require is not a function).
const cjsRequire = createRequire(import.meta.url);
const { parser } = cjsRequire('stream-json');
const { pick } = cjsRequire('stream-json/filters/Pick');
const { streamArray } = cjsRequire('stream-json/streamers/StreamArray');
const { streamValues } = cjsRequire('stream-json/streamers/StreamValues');

// Webpack/Vite stats prefix loader-resolved virtual modules with a NUL byte
// (e.g. "\u0000/path/to/file?commonjs-es-import"). Strip it so the path lines
// up with the absolute paths in our file index. Built via String.fromCharCode
// to avoid embedding a control char in source / tripping no-control-regex.
const NULL_CHAR = String.fromCharCode(0);
// split/join instead of String.prototype.replaceAll: replaceAll is Node 15+
// and cli-command supports Node >=14.
/* istanbul ignore next: the non-string branch is defensive — resolveAndIndex
   only ever passes stats string values, and a non-string would throw at the
   path.isAbsolute call below anyway */
const stripNull = s => (typeof s === 'string' ? s.split(NULL_CHAR).join('') : s);

// Status poll cadence: 12 attempts × 5s = 1 minute total.
const POLL_INTERVAL_MS = 5000;
const POLL_ATTEMPTS = 12;

const GLOB_CHARS = /[*?]/;
const MAX_PATTERN_LENGTH = 500;

function patternToRegex(pattern) {
  /* istanbul ignore next: callers (matchesPattern) only ever pass a string, so
     the typeof guard is defensive; the length guard is exercised at runtime by
     the over-long-glob test via the matchesPattern catch below */
  if (typeof pattern !== 'string' || pattern.length > MAX_PATTERN_LENGTH) {
    throw new Error('Invalid pattern: must be a string with max length of 500 characters');
  }
  return globToRegExp(pattern, { extended: true, globstar: true });
}

function matchesPattern(str, pattern) {
  if (GLOB_CHARS.test(pattern)) {
    try {
      return patternToRegex(pattern).test(str);
    } catch {
      return false;
    }
  }
  return str === pattern;
}

// Thrown from any pipeline step that wants to fall back to the full snapshot
// set. The caller in snapshots.js downgrades these to log.info — they're
// expected, user-visible bail conditions, not crashes.
export class IntelliStoryBailError extends Error {
  constructor(message) {
    super(message);
    this.name = 'IntelliStoryBailError';
  }
}

// Any git failure is treated as a recoverable bail (full snapshot fallback),
// per this module's contract. A common trigger is CI shallow clones where the
// predicted base commit isn't fetched locally, so `git diff <sha> HEAD` fails —
// we must downgrade that to a full snapshot, not crash the build. Callers that
// want a more specific bail message (e.g. lockfile lookup) catch and re-throw.
function git(args) {
  let res;
  try {
    res = spawnSync('git', args, { encoding: 'utf8' });
  } catch (e) {
    /* istanbul ignore next: spawnSync only throws on an exec-level failure (e.g.
       git binary missing / ENOMEM), which the test environment can't induce —
       the non-zero-exit bail below is the path real git failures take */
    throw new IntelliStoryBailError(`IntelliStory: git ${args.join(' ')} failed to spawn: ${e.message}; running full snapshot set`);
  }
  if (res.status !== 0) {
    /* istanbul ignore next: the stderr||stdout||exit-code fallbacks in the
       message are defensive — git failures in tests always carry stderr */
    throw new IntelliStoryBailError(`IntelliStory: git ${args.join(' ')} failed: ${res.stderr || res.stdout || `exit ${res.status}`}; running full snapshot set`);
  }
  return res.stdout;
}

// baseRef flows into `git` argv from either user config (`baseline`) or the
// API. Reject anything that could be parsed as an option (leading `-`) or
// contains chars outside the safe ref alphabet — git also accepts `--` as an
// end-of-options separator in `git diff`, but not before the rev in
// `git show <rev>:<path>`, so validation is the only universal guard.
function assertSafeRef(ref) {
  if (typeof ref !== 'string' || !/^[A-Za-z0-9_./][A-Za-z0-9_./-]*$/.test(ref)) {
    throw new IntelliStoryBailError(`IntelliStory: unsafe baseline ref "${ref}"; running full snapshot set`);
  }
}

function gitDiffNames(ref) {
  assertSafeRef(ref);
  return git(['diff', '--name-only', ref, 'HEAD', '--']).split('\n').filter(Boolean);
}

function gitProjectRoot() {
  return git(['rev-parse', '--show-toplevel']).trim();
}

// Parse `git diff --unified=0` hunk headers to find which line ranges are new
// or changed (on the HEAD side) for each file, then key them by the file's
// index in the stats `files` array — the same index module/source refs use, so
// the graph can join them without a path lookup. `--unified=0` drops context
// lines so every hunk header bounds an actual change; `--no-renames` makes a
// rename surface as add+delete so the new path is always concrete.
//
// Files in the diff that aren't tracked in `files` (e.g. node_modules,
// .storybook, or anything the stats compactor didn't index) are skipped — the
// graph can only reason about indexed files. Returns { <fileIndex>: [[start, end], ...] }.
export function getAffectedFileLocations(baseRef, files) {
  assertSafeRef(baseRef);
  const diff = git(['diff', '--unified=0', '--no-color', '--no-renames', baseRef, 'HEAD', '--']);

  // The `files` array uses the platform separator (path.relative → back-slash
  // on Windows); git diff always emits forward slashes. Normalize both to
  // forward-slash for the path→index lookup.
  const toPosix = p => p.split(path.sep).join('/');
  const indexByPath = new Map(files.map((f, i) => [toPosix(f), i]));

  // @@ -a,b +c,d @@ — the new-side `+c,d` is what we want. `d` defaults to 1
  // when omitted; `d === 0` is a pure deletion anchored at line c (no added
  // lines), so it contributes no range.
  const HUNK = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/;

  const locations = {};
  let currentIdx;
  for (const line of diff.split('\n')) {
    // `+++ b/<path>` opens a file's hunks with its new-side path; a pure
    // deletion shows `+++ /dev/null`, so leave currentIdx unset and skip it.
    if (line.startsWith('+++ ')) {
      const p = line.slice(4);
      if (p === '/dev/null') { currentIdx = undefined; continue; }
      /* istanbul ignore next: git always prefixes the new-side path with `b/`
         (anything else is `/dev/null`, handled above), so the bare `: p`
         fallback is defensive and unreachable in real diff output */
      const rel = p.startsWith('b/') ? p.slice(2) : p;
      currentIdx = indexByPath.get(rel);
      continue;
    }
    if (currentIdx === undefined) continue;
    const m = HUNK.exec(line);
    if (!m) continue;
    const start = parseInt(m[1], 10);
    const count = m[2] === undefined ? 1 : parseInt(m[2], 10);
    if (count === 0) continue;
    if (!locations[currentIdx]) locations[currentIdx] = [];
    locations[currentIdx].push([start, start + count - 1]);
  }
  return locations;
}

// Paths under these directories are dependencies / framework wiring rather
// than first-party source, so we don't track them in the file index.
const EXCLUDED_DIRS = new Set(['node_modules', '.storybook']);
const isExcluded = relPath => relPath.split(/[/\\]/).some(seg => EXCLUDED_DIRS.has(seg));

// Resolve+index used for `id` and `resolvedFrom` only. Converts absolute paths
// to projectRoot-relative form, then either returns the existing index for that
// path or assigns the next one (= current map size). Paths inside node_modules
// or .storybook are returned as the relative string and *not* indexed; modules
// whose id falls into that bucket are dropped downstream by the
// "id is string → drop" contract in transformModule.
function resolveAndIndex(value, fileIndex, projectRoot) {
  const clean = stripNull(value);
  if (!path.isAbsolute(clean)) return clean;
  const rel = path.relative(projectRoot, clean);
  if (isExcluded(rel)) return rel;
  let idx = fileIndex.get(rel);
  if (idx === undefined) {
    idx = fileIndex.size;
    fileIndex.set(rel, idx);
  }
  return idx;
}

// Transform a stats `modules[]` entry into the indexed shape the IntelliStory graph expects.
// Returns null when the module's id is a string — those entries are dropped (per BE contract).
// Each `imports[i]` / `passThroughExports[i]` carries `{ type, source }` from the
// bundler-plugin: for `type === 'src'` we translate the absolute file path to its
// project-file index when possible; for `type === 'module'` the source is already
// the bare package name, so we leave it alone.
function transformModule(m, fileIndex, projectRoot) {
  const out = {};
  if (m.id != null) out.id = resolveAndIndex(m.id, fileIndex, projectRoot);
  if (typeof out.id === 'string') return null;

  const mapEntry = (e) => {
    const copy = { ...e };
    if (copy.type === 'src' && typeof copy.source === 'string') {
      copy.source = resolveAndIndex(copy.source, fileIndex, projectRoot);
    }
    // `loc` (when present) is an array of `{ start, end }` source spans; the
    // graph expects each span as a `[start, end]` tuple instead.
    if (Array.isArray(copy.loc)) {
      copy.loc = copy.loc.map(l => [l.start, l.end]);
    }
    return copy;
  };

  if (Array.isArray(m.imports)) out.imports = m.imports.map(mapEntry);
  if (Array.isArray(m.passThroughExports)) out.passThroughExports = m.passThroughExports.map(mapEntry);
  if (Array.isArray(m.nonPassThroughExports)) out.nonPassThroughExports = m.nonPassThroughExports;

  return out;
}

function streamModules(filePath, onModule) {
  return new Promise((resolve, reject) => {
    fs.createReadStream(filePath)
      .pipe(parser())
      .pipe(pick({ filter: 'modules' }))
      .pipe(streamArray())
      .on('data', ({ value }) => onModule(value))
      .on('end', resolve)
      .on('error', reject);
  });
}

function readTopLevelKey(filePath, key) {
  return new Promise((resolve, reject) => {
    let value;
    fs.createReadStream(filePath)
      .pipe(parser())
      .pipe(pick({ filter: key }))
      .pipe(streamValues())
      .on('data', ({ value: v }) => { value = v; })
      .on('end', () => resolve(value))
      .on('error', reject);
  });
}

async function readStats(statsFile, projectRoot) {
  const fileIndex = new Map();
  const modules = [];
  await streamModules(statsFile, (m) => {
    const t = transformModule(m, fileIndex, projectRoot);
    if (t) modules.push(t);
  });

  // Emit `files` ordered by encounter-time index so files[N] corresponds to
  // every module/source ref that was assigned index N during streaming.
  const files = [...fileIndex.entries()]
    .sort((a, b) => a[1] - b[1])
    .map(([p]) => p);

  // The bundler-plugin-intelliStory emits a unique buildId per storybook build
  // so concurrent runs against the same project don't share Redis state.
  const buildId = await readTopLevelKey(statsFile, 'buildId');
  return { files, modules, buildId };
}

// Polls `job_status?sync=true&type=intelli_story_graph&id=<buildId>` — the sync
// response blocks server-side until the job moves off `in_progress`, but the
// API enforces a shorter timeout than the job can take, so we retry up to
// POLL_ATTEMPTS times. On `done` the response also carries the graph payload
// (affected stories + vertices/edges/transitive closure for trace
// rendering), so the caller reads it directly without a second fetch.
//
// Response shape is the unwrapped `{ status, data }` — the intelli_story_graph
// status response no longer keys the result by buildId.
async function pollGraphStatus(percy, buildId, log) {
  for (let i = 0; i < POLL_ATTEMPTS; i++) {
    const res = await percy.client.getStatus('intelli_story_graph', [buildId]);
    const status = res?.status;
    log.debug(`IntelliStory: graph status (attempt ${i + 1}) = ${status}`);
    if (status === 'done' || status === 'failed') return { status, data: res?.data };
    if (i < POLL_ATTEMPTS - 1) await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
  }
  return { status: null };
}

// First component: resolve + validate the statsFile path, stream-read it, and
// assert it carries a usable buildId. Returns { files, modules, buildId }; any
// problem throws a IntelliStoryBailError so the caller falls back to a full set.
export async function validateAndReadStats(buildDir, statsFile, projectRoot, log) {
  // Treat statsFile as a flat filename anchored inside the build directory.
  // path.basename() strips any traversal segments so the resolved path can't
  // escape buildDir even if the config is hostile.
  const statsName = path.basename(statsFile || 'enriched-stats.json');
  if (!/^[\w.-]+\.json$/i.test(statsName)) {
    throw new IntelliStoryBailError(`IntelliStory: invalid statsFile "${statsName}" — must be a .json filename; running full snapshot set`);
  }
  // statsName is path.basename'd and regex-validated above; buildDir is operator-supplied config (reviewed, approved by security)
  const resolvedStatsPath = path.join(path.resolve(buildDir), statsName); // nosemgrep
  let statsStat;
  try {
    statsStat = fs.statSync(resolvedStatsPath);
  } catch {
    throw new IntelliStoryBailError(`IntelliStory: stats file "${statsName}" not found in build directory ${buildDir}; running full snapshot set`);
  }
  if (!statsStat.isFile()) {
    throw new IntelliStoryBailError(`IntelliStory: stats file "${statsName}" in ${buildDir} is not a regular file; running full snapshot set`);
  }

  log.debug(`IntelliStory: parsing stats file ${resolvedStatsPath}`);
  const { files, modules, buildId } = await readStats(resolvedStatsPath, projectRoot);

  if (typeof buildId !== 'string' || !buildId) {
    throw new IntelliStoryBailError(`IntelliStory: stats file at ${resolvedStatsPath} is missing a top-level "buildId" — running full snapshot set`);
  }

  return { files, modules, buildId };
}

// Resolve the diff base ref + the list of changed files. With an explicit
// `baseline` we diff against it directly and skip the API base-build lookup
// entirely (its snapshot map is only consulted on the no-baseline path), so
// `baselineSnapshots` comes back null in that case.
export async function getBaselineAndAffectedNodes(percy, baseline, log) {
  let baseRef;
  let baselineSnapshots;

  if (baseline) {
    log.debug(`IntelliStory: diffing against explicit baseline "${baseline}"`);
    baseRef = baseline;
    baselineSnapshots = null;
  } else {
    // New API shape: `{ base_build_commit_sha, snapshots: { <name>: <review_state> } }`.
    // The single base-build commit replaces the previous per-snapshot commit map —
    // baseline prediction now happens server-side via `Percy::BaseBuildService`,
    // so we just diff against whatever commit it picked. The set of snapshot
    // names is no longer sent; the API resolves baselines from the project +
    // git/PR context alone.
    const baseLookup = await percy.client.getIntelliStorySnapshotNameToCommit();
    log.debug(`IntelliStory: base lookup ${JSON.stringify(baseLookup)}`);
    if (!baseLookup?.base_build_commit_sha) {
      throw new IntelliStoryBailError('IntelliStory: API could not predict a base build commit and no explicit baseline was set; running full snapshot set');
    }
    log.debug(`IntelliStory: diffing against predicted base build commit "${baseLookup.base_build_commit_sha}"`);
    baseRef = baseLookup.base_build_commit_sha;
    baselineSnapshots = baseLookup.snapshots || {};
  }

  assertSafeRef(baseRef);
  const affectedNodes = gitDiffNames(baseRef);
  return { baseRef, affectedNodes, baselineSnapshots };
}

// A change to anything under `.storybook/` (preview config, addons, manager
// wiring) can affect every story's render, so the dep graph isn't enough.
export function assertNoDotStorybookChange(affectedNodes) {
  const dotStorybookHit = affectedNodes.find(p => p.split(/[/\\]/).includes('.storybook'));
  if (dotStorybookHit) {
    throw new IntelliStoryBailError(`IntelliStory: change to "${dotStorybookHit}" inside .storybook affects all stories; running full snapshot set`);
  }
}

// Bail to a full snapshot set if any changed file matches a user-supplied
// bailOnChanges glob.
export function assertNoBailOnChanges(affectedNodes, bailOnChanges) {
  if (bailOnChanges?.length) {
    const bailed = affectedNodes.find(p => bailOnChanges.some(g => matchesPattern(p, g)));
    if (bailed) {
      throw new IntelliStoryBailError(`IntelliStory: change to "${bailed}" matched bailOnChanges; running full snapshot set`);
    }
  }
}

// Drop changed files that match a user-supplied `untraced` glob so they don't
// drive snapshot selection. Returns the filtered list (unchanged when no
// untraced patterns are configured).
export function enforceUntraced(affectedNodes, untraced) {
  if (untraced?.length) {
    return affectedNodes.filter(p => !untraced.some(g => matchesPattern(p, g)));
  }
  return affectedNodes;
}

// Manifest/lockfile changes can shift the dependency tree, so resolve the
// diff at the package level via snyk-nodejs-lockfile-parser and return the
// changed package names to feed back into the graph. Returns [] when there's
// nothing to resolve; short-circuits below fall back to a full snapshot
// (via IntelliStoryBailError) whenever we can't reason about the change.
export async function getAffectedPackages(affectedNodes, baseRef, projectRoot, log) {
  const MANIFEST_PATHS = new Set(['package.json', 'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml']);
  const manifestHits = affectedNodes.filter(p => MANIFEST_PATHS.has(path.basename(p)));

  if (manifestHits.length === 0) return [];

  // Locate the changed manifest's directory from affectedNodes (NOT the git
  // root) — monorepos keep package.json + lockfile inside a workspace dir.
  // If two changes land in different dirs, we'd need per-workspace resolution
  // we don't try to do yet, so bail.
  const uniqueDirs = [...new Set(manifestHits.map(p => path.dirname(p)))];
  if (uniqueDirs.length > 1) {
    throw new IntelliStoryBailError(`IntelliStory: manifest changes span multiple directories (${uniqueDirs.join(', ')}); running full snapshot set`);
  }
  const manifestDir = uniqueDirs[0]; // repo-relative; '.' for root
  // manifestDir is derived from git-tracked paths under projectRoot (reviewed, approved by security)
  const absManifestDir = path.resolve(projectRoot, manifestDir); // nosemgrep

  // Pick the lockfile that lives next to the changed manifest. If two
  // coexist (e.g. a stray package-lock.json next to yarn.lock) we can't
  // pick a canonical source, so bail.
  const LOCKFILE_NAMES = ['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml'];
  // n is from the hardcoded LOCKFILE_NAMES allowlist (reviewed, approved by security)
  const presentLockfiles = LOCKFILE_NAMES.filter(n => fs.existsSync(path.join(absManifestDir, n))); // nosemgrep
  if (presentLockfiles.length === 0) {
    throw new IntelliStoryBailError(`IntelliStory: manifest changed in "${manifestDir}" but no lockfile present there; running full snapshot set`);
  }
  if (presentLockfiles.length > 1) {
    throw new IntelliStoryBailError(`IntelliStory: multiple lockfiles in "${manifestDir}" (${presentLockfiles.join(', ')}); cannot pick canonical; running full snapshot set`);
  }
  const lockfileName = presentLockfiles[0];
  // git always uses forward slashes for its <rev>:<path> spec; build it by
  // hand instead of path.join (which would use backslashes on Windows).
  const lockfileRepoPath = manifestDir === '.' ? lockfileName : `${manifestDir}/${lockfileName}`;

  // Resolve the lockfile at the base commit. If it wasn't tracked there
  // (first IntelliStory run, lockfile renamed, etc.) we can't diff, so bail.
  let oldLockfile;
  try {
    oldLockfile = git(['show', `${baseRef}:${lockfileRepoPath}`]);
  } catch {
    throw new IntelliStoryBailError(`IntelliStory: lockfile "${lockfileRepoPath}" not present at base ref ${baseRef}; running full snapshot set`);
  }

  // lockfileName is one of the hardcoded LOCKFILE_NAMES allowlist (reviewed, approved by security)
  const newLockfile = fs.readFileSync(path.join(absManifestDir, lockfileName), 'utf8'); // nosemgrep

  // Byte-identical lockfile means only package.json's non-dep fields changed —
  // nothing shifted in the dependency tree, so there are no affected packages.
  if (oldLockfile === newLockfile) return [];

  // joined with the literal 'package.json' under the resolved absManifestDir (reviewed, approved by security)
  const packageJson = fs.readFileSync(path.join(absManifestDir, 'package.json'), 'utf8'); // nosemgrep
  const packageJsonRepoPath = manifestDir === '.' ? 'package.json' : `${manifestDir}/package.json`;
  const oldPackageJson = git(['show', `${baseRef}:${packageJsonRepoPath}`]);
  try {
    const packageAffected = await diffLockfileDeps({
      packageJson,
      oldLockfile,
      newLockfile,
      lockfileType: lockfileName,
      oldPackageJson
    });
    // The two statements below run only on Node >=18 where the snyk parser
    // loads; the CI matrix runs the suite on Node 14, where the await above
    // throws SNYK_LOCKFILE_PARSER_UNAVAILABLE and we take the catch instead.
    /* istanbul ignore next */
    log.debug(`IntelliStory: lockfile diff produced ${packageAffected.length} affected packages: ${packageAffected.join(', ')}`);
    /* istanbul ignore next */
    return packageAffected;
  } catch (e) {
    // snyk-nodejs-lockfile-parser is an optionalDependency (requires Node >=18).
    // When it's missing we can't reason about the manifest change, so we
    // conservatively bail to a full snapshot rather than under-snapshotting.
    /* istanbul ignore else: a non-snyk diff error can only surface on Node >=18 */
    if (e.code === 'SNYK_LOCKFILE_PARSER_UNAVAILABLE') {
      throw new IntelliStoryBailError(`IntelliStory: ${e.message}; running full snapshot set`);
    }
    /* istanbul ignore next: non-snyk diff errors only surface on Node >=18 */
    throw e;
  }
}

// Project each snapshot's importPath into the project-root frame and return
// the unique set. Logs how many snapshots carried an importPath and warns
// (with a sample) when none do, which usually means broken story extraction.
export function extractStorybookPaths(snapshots, normalizeImportPath, log) {
  const storybookPaths = [...new Set(snapshots.map(s => normalizeImportPath(s.importPath)).filter(Boolean))];
  const snapshotsWithImportPath = snapshots.filter(s => s.importPath).length;
  log.debug(`IntelliStory: ${snapshotsWithImportPath}/${snapshots.length} snapshots have importPath; ${storybookPaths.length} unique storybookPaths`);
  if (storybookPaths.length === 0) {
    log.warn(`IntelliStory: no snapshots have importPath set — check Storybook story extraction. Sample snapshot: ${JSON.stringify({
      id: snapshots[0]?.id, name: snapshots[0]?.name, importPath: snapshots[0]?.importPath, keys: snapshots[0] ? Object.keys(snapshots[0]) : []
    })}`);
  } else {
    log.debug(`IntelliStory: storybookPaths sample: ${storybookPaths.slice(0, 3).join(', ')}`);
  }
  return storybookPaths;
}

// Kick off the graph generation job and poll it to completion, returning the
// graph payload. The sync status response carries the graph payload directly
// on completion, so there's no second fetch — the returned `data` is the same
// response body that used to come from `getIntelliStoryGraphData`. Bails to a
// full snapshot set if the job doesn't reach `done`.
export async function runGraphGeneration(percy, buildId, payload, log) {
  const { files, modules, storybookPaths, affectedNodes, affectedFileLocations } = payload;
  log.debug(`IntelliStory: starting graph generation job ${JSON.stringify({ buildId, files, modules, storybookPaths, affectedNodes, affectedFileLocations })}`);
  // Pass camelCase to the client, which snake_cases it to `affected_file_locations`
  // for the API (same convention as storybookPaths → storybook_paths).
  await percy.client.generateIntelliStoryGraph(buildId, {
    files, modules, storybookPaths, affectedNodes, affectedFileLocations
  });

  const { status, data } = await pollGraphStatus(percy, buildId, log);
  if (status !== 'done') {
    throw new IntelliStoryBailError(`IntelliStory: graph generation did not complete (status: ${status ?? 'timed out'}); running full snapshot set`);
  }

  log.debug(`IntelliStory: affected stories result ${JSON.stringify(data?.affected_stories)}`);
  return data;
}

// Trace rendering moved client-side: the API now returns the raw graph
// (vertices, edges, transitive-closure triples) and we populate the bundled
// HTML template here. Only runs when `trace` is enabled and the payload is
// complete — anything missing means the BE couldn't produce a graph, so we
// skip silently rather than write a broken page.
export function maybeWriteTrace(trace, data, log) {
  if (trace && data?.vertices && data?.edges && data?.transitive_closure_matrix_sparse) {
    const tracePath = path.resolve(process.cwd(), 'trace.html');
    try {
      const html = renderGraphTraceHtml({
        vertices: data.vertices,
        edges: data.edges,
        transitiveClosureMatrixSparse: data.transitive_closure_matrix_sparse
      });
      fs.writeFileSync(tracePath, html);
      log.info(`IntelliStory: trace written to ${tracePath}`);
    } catch (e) {
      log.warn(`IntelliStory: failed to write trace.html: ${e.message}`);
    }
  }
}

// Filter the snapshots down to those the affected-graph reports plus any that
// need a forced re-snapshot, log the summary, and return the kept list.
//
// Snapshots whose baseline review_state is `failed` or `rejected` have no
// usable baseline image to diff against, and snapshots that don't appear in
// the base build at all are brand-new (no baseline exists yet). In both cases
// IntelliStory can't legitimately skip them — re-snapshot unconditionally
// regardless of what the affected-graph reports. `baselineSnapshots` is null
// when an explicit baseline is set, but `needsBaselineRefresh` short-circuits
// on `baseline` before reading it.
export function selectAffectedSnapshots(snapshots, data, baseline, baselineSnapshots, normalizeImportPath, log) {
  const affected = new Set(data?.affected_stories || []);

  const FORCE_RESNAPSHOT_STATES = new Set(['failed', 'rejected']);
  const needsBaselineRefresh = name => {
    if (baseline) return false;
    const state = baselineSnapshots[name];
    return state === undefined || FORCE_RESNAPSHOT_STATES.has(state);
  };

  // Use the same normalization on lookup so a snapshot's `./src/...` matches
  // an affected-stories `src/...` from the API.
  let forced = 0;
  let affectedKept = 0;
  const filtered = snapshots.filter(s => {
    if (needsBaselineRefresh(s.name)) {
      forced += 1;
      return true;
    }
    const p = normalizeImportPath(s.importPath);
    if (p && affected.has(p)) {
      affectedKept += 1;
      return true;
    }
    return false;
  });
  log.info(`IntelliStory: ${filtered.length} of ${snapshots.length} snapshots kept (${affectedKept} via affected-graph, ${forced} via missing/failed/rejected baseline)`);
  return filtered;
}

// Given the mapped snapshots and storybook.intelliStory config, returns the subset of snapshots
// that the IntelliStory graph reports as affected. On any recoverable failure, returns the input
// list unchanged so the build runs as a full snapshot pass.
export async function applyIntelliStory(percy, snapshots, intelliStoryConfig, buildDir) {
  const log = logger('storybook:intelliStory');
  const { baseline, untraced, trace, bailOnChanges, statsFile } = intelliStoryConfig || {};

  if (!buildDir) {
    throw new IntelliStoryBailError('IntelliStory requires the Storybook build directory (e.g. `percy storybook ./storybook-static`); URL and `start` modes are not supported. Running full snapshot set');
  }

  const projectRoot = gitProjectRoot();

  const { files, modules, buildId } = await validateAndReadStats(buildDir, statsFile, projectRoot, log);

  let { baseRef, affectedNodes, baselineSnapshots } = await getBaselineAndAffectedNodes(percy, baseline, log);

  assertNoDotStorybookChange(affectedNodes);
  assertNoBailOnChanges(affectedNodes, bailOnChanges);
  affectedNodes = enforceUntraced(affectedNodes, untraced);

  const packageAffectedNodes = await getAffectedPackages(affectedNodes, baseRef, projectRoot, log);

  // With no traced files and no package-level changes there's nothing for the
  // graph to reason about — bail to a full snapshot set rather than send an
  // empty diff.
  if (!affectedNodes.length && !packageAffectedNodes.length) {
    throw new IntelliStoryBailError('IntelliStory: no affected files or packages detected after filtering; running full snapshot set');
  }

  // Storybook's `entries[id].importPath` (and v6 `parameters.fileName`)
  // is resolved relative to the directory percy was invoked from — for a
  // monorepo storybook that's typically the package dir (e.g.
  // `frontend/packages/design-stack`), not the git root. Example:
  // `./modules/AgentCard/AgentCard.stories.tsx`.
  //
  // `affectedNodes` from `git diff --name-only` and the `files` array
  // built by the stats compactor are both project-root-relative
  // (e.g. `packages/design-stack/modules/AgentCard/AgentCard.stories.tsx`).
  // Project them into the same frame so the BE matches importPath against
  // affectedNodes without a cross-frame translation.
  const dotPosix = './';
  const dotPlatform = `.${path.sep}`;
  const invocationDir = process.cwd();
  const normalizeImportPath = p => {
    if (typeof p !== 'string' || !p) return p;
    let rel = p;
    /* istanbul ignore next: on POSIX CI dotPlatform === dotPosix ('./'), so the
       dotPosix else-if (a Windows-only '.\\' case) is unreachable there; ignore
       the whole prefix-strip chain rather than a single dead else-if branch */
    if (rel.startsWith(dotPlatform)) rel = rel.slice(dotPlatform.length);
    else if (rel.startsWith(dotPosix)) rel = rel.slice(dotPosix.length);
    // If the importPath happens to be absolute (older Storybook configs),
    // path.resolve treats it as the target directly; otherwise it's joined
    // against `invocationDir`. Then re-base against the git project root.
    // rel comes from build stats file paths, re-based against projectRoot on the next line (reviewed, approved by security)
    const abs = path.resolve(invocationDir, rel); // nosemgrep
    const projRel = path.relative(projectRoot, abs);
    // path.relative('','') → '' and `path.relative` produces backslashes
    // on Windows; the stats `files` array uses the same — leave platform
    // sep alone so the two stay byte-identical for the BE match.
    /* istanbul ignore next: the `|| rel` fallback only triggers when an importPath
       resolves exactly to projectRoot (projRel === ''), an edge that's unstable to
       reproduce across OS symlink/tmpdir differences */
    return projRel || rel;
  };

  const storybookPaths = extractStorybookPaths(snapshots, normalizeImportPath, log);

  /* istanbul ignore next: packageAffectedNodes is only non-empty on Node >=18
     (the snyk lockfile diff); on the Node-14 CI getAffectedPackages either
     returns [] or bails before yielding packages, so this never runs there */
  if (packageAffectedNodes.length) {
    affectedNodes = [...affectedNodes, ...packageAffectedNodes];
  }

  // Line-level diff ranges for the indexed files, keyed by their `files` index.
  const affectedFileLocations = getAffectedFileLocations(baseRef, files);

  const data = await runGraphGeneration(percy, buildId, { files, modules, storybookPaths, affectedNodes, affectedFileLocations }, log);

  maybeWriteTrace(trace, data, log);

  return selectAffectedSnapshots(snapshots, data, baseline, baselineSnapshots, normalizeImportPath, log);
}
