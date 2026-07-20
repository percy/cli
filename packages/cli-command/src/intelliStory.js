import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import globToRegExp from 'glob-to-regexp';
import logger from '@percy/logger';
import { diffLockfileDeps } from './lockfileDiff.js';
import { renderGraphTraceHtml } from './graphTrace.js';

const NULL_CHAR = String.fromCharCode(0);
/* istanbul ignore next */
const stripNull = s => (typeof s === 'string' ? s.split(NULL_CHAR).join('') : s);

const POLL_INTERVAL_MS = 5000;
const POLL_ATTEMPTS = 12;

const GLOB_CHARS = /[*?]/;
const MAX_PATTERN_LENGTH = 500;

function patternToRegex(pattern) {
  /* istanbul ignore next */
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

export class IntelliStoryBailError extends Error {
  constructor(message) {
    super(message);
    this.name = 'IntelliStoryBailError';
  }
}

function git(args) {
  let res;
  try {
    res = spawnSync('git', args, { encoding: 'utf8' });
  } catch (e) {
    /* istanbul ignore next */
    throw new IntelliStoryBailError(`IntelliStory: git ${args.join(' ')} failed to spawn: ${e.message}; running full snapshot set`);
  }
  if (res.status !== 0) {
    /* istanbul ignore next */
    throw new IntelliStoryBailError(`IntelliStory: git ${args.join(' ')} failed: ${res.stderr || res.stdout || `exit ${res.status}`}; running full snapshot set`);
  }
  return res.stdout;
}

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

export function getAffectedFileLocations(baseRef, files) {
  assertSafeRef(baseRef);
  const diff = git(['diff', '--unified=0', '--no-color', '--no-renames', baseRef, 'HEAD', '--']);

  const toPosix = p => p.split(path.sep).join('/');
  const indexByPath = new Map(files.map((f, i) => [toPosix(f), i]));

  const HUNK = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/;

  const locations = {};
  let currentIdx;
  for (const line of diff.split('\n')) {
    if (line.startsWith('+++ ')) {
      const p = line.slice(4);
      if (p === '/dev/null') { currentIdx = undefined; continue; }
      /* istanbul ignore next */
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

const EXCLUDED_DIRS = new Set(['node_modules', '.storybook']);
const isExcluded = relPath => relPath.split(/[/\\]/).some(seg => EXCLUDED_DIRS.has(seg));

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

function transformModule(m, fileIndex, projectRoot) {
  const out = {};
  if (m.id != null) out.id = resolveAndIndex(m.id, fileIndex, projectRoot);
  if (typeof out.id === 'string') return null;

  const mapEntry = (e) => {
    const copy = { ...e };
    if (copy.type === 'src' && typeof copy.source === 'string') {
      copy.source = resolveAndIndex(copy.source, fileIndex, projectRoot);
    }
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

function readStats(statsFile, projectRoot) {
  const fileIndex = new Map();
  const modules = [];
  const stats = JSON.parse(fs.readFileSync(statsFile, 'utf8'));
  /* istanbul ignore next */
  const rawModules = stats.modules || [];
  for (const m of rawModules) {
    const t = transformModule(m, fileIndex, projectRoot);
    if (t) modules.push(t);
  }

  const files = [...fileIndex.entries()]
    .sort((a, b) => a[1] - b[1])
    .map(([p]) => p);

  return { files, modules, buildId: stats.buildId };
}

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

export async function validateAndReadStats(buildDir, statsFile, projectRoot, log) {
  const statsName = path.basename(statsFile || 'enriched-stats.json');
  if (!/^[\w.-]+\.json$/i.test(statsName)) {
    throw new IntelliStoryBailError(`IntelliStory: invalid statsFile "${statsName}" — must be a .json filename; running full snapshot set`);
  }
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
  // The graph is now keyed by the Percy build id, not the stats-file `buildId`,
  // so a missing `buildId` in the stats file is no longer fatal. We only need
  // the module graph (`files`/`modules`) from here.
  const { files, modules } = await readStats(resolvedStatsPath, projectRoot);

  return { files, modules };
}

export async function getBaselineAndAffectedNodes(percy, baseline, log) {
  let baseRef;
  let baselineSnapshots;

  // Always look up the base build: its `browser_upgrade` flag forces a full
  // snapshot run regardless of whether an explicit baseline was configured.
  const baseLookup = await percy.client.getIntelliStorySnapshotNameToCommit(percy.build?.id);
  log.debug(`IntelliStory: base lookup ${JSON.stringify(baseLookup)}`);

  if (baseLookup?.browser_upgrade) {
    throw new IntelliStoryBailError('IntelliStory: This build has to take all snapshots by fallback because this build corresponds to a browser upgrade');
  }

  if (baseline) {
    log.debug(`IntelliStory: diffing against explicit baseline "${baseline}"`);
    baseRef = baseline;
    baselineSnapshots = null;
  } else {
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

export function assertNoDotStorybookChange(affectedNodes) {
  const dotStorybookHit = affectedNodes.find(p => p.split(/[/\\]/).includes('.storybook'));
  if (dotStorybookHit) {
    throw new IntelliStoryBailError(`IntelliStory: change to "${dotStorybookHit}" inside .storybook affects all stories; running full snapshot set`);
  }
}

export function assertNoBailOnChanges(affectedNodes, bailOnChanges) {
  if (bailOnChanges?.length) {
    const bailed = affectedNodes.find(p => bailOnChanges.some(g => matchesPattern(p, g)));
    if (bailed) {
      throw new IntelliStoryBailError(`IntelliStory: change to "${bailed}" matched bailOnChanges; running full snapshot set`);
    }
  }
}

export function enforceUntraced(affectedNodes, untraced) {
  if (untraced?.length) {
    return affectedNodes.filter(p => !untraced.some(g => matchesPattern(p, g)));
  }
  return affectedNodes;
}

export async function getAffectedPackages(affectedNodes, baseRef, projectRoot, log) {
  const MANIFEST_PATHS = new Set(['package.json', 'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml']);
  const manifestHits = affectedNodes.filter(p => MANIFEST_PATHS.has(path.basename(p)));

  if (manifestHits.length === 0) return [];

  const uniqueDirs = [...new Set(manifestHits.map(p => path.dirname(p)))];
  if (uniqueDirs.length > 1) {
    throw new IntelliStoryBailError(`IntelliStory: manifest changes span multiple directories (${uniqueDirs.join(', ')}); running full snapshot set`);
  }
  const manifestDir = uniqueDirs[0];
  const absManifestDir = path.resolve(projectRoot, manifestDir); // nosemgrep

  const LOCKFILE_NAMES = ['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml'];
  const presentLockfiles = LOCKFILE_NAMES.filter(n => fs.existsSync(path.join(absManifestDir, n))); // nosemgrep
  if (presentLockfiles.length === 0) {
    throw new IntelliStoryBailError(`IntelliStory: manifest changed in "${manifestDir}" but no lockfile present there; running full snapshot set`);
  }
  if (presentLockfiles.length > 1) {
    throw new IntelliStoryBailError(`IntelliStory: multiple lockfiles in "${manifestDir}" (${presentLockfiles.join(', ')}); cannot pick canonical; running full snapshot set`);
  }
  const lockfileName = presentLockfiles[0];
  const lockfileRepoPath = manifestDir === '.' ? lockfileName : `${manifestDir}/${lockfileName}`;

  let oldLockfile;
  try {
    oldLockfile = git(['show', `${baseRef}:${lockfileRepoPath}`]);
  } catch {
    throw new IntelliStoryBailError(`IntelliStory: lockfile "${lockfileRepoPath}" not present at base ref ${baseRef}; running full snapshot set`);
  }

  const newLockfile = fs.readFileSync(path.join(absManifestDir, lockfileName), 'utf8'); // nosemgrep

  if (oldLockfile === newLockfile) return [];

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
    /* istanbul ignore next */
    log.debug(`IntelliStory: lockfile diff produced ${packageAffected.length} affected packages: ${packageAffected.join(', ')}`);
    /* istanbul ignore next */
    return packageAffected;
  } catch (e) {
    /* istanbul ignore else */
    if (e.code === 'SNYK_LOCKFILE_PARSER_UNAVAILABLE') {
      throw new IntelliStoryBailError(`IntelliStory: ${e.message}; running full snapshot set`);
    }
    /* istanbul ignore next */
    throw e;
  }
}

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

export async function runGraphGeneration(percy, buildId, payload, log) {
  const { files, modules, storybookPaths, affectedNodes, affectedFileLocations } = payload;
  log.debug(`IntelliStory: starting graph generation job ${JSON.stringify({ buildId, files, modules, storybookPaths, affectedNodes, affectedFileLocations })}`);
  await percy.client.generateIntelliStoryGraph(buildId, {
    files, modules, storybookPaths, affectedNodes, affectedFileLocations
  });

  const { status } = await pollGraphStatus(percy, buildId, log);
  if (status !== 'done') {
    throw new IntelliStoryBailError(`IntelliStory: graph generation did not complete (status: ${status ?? 'timed out'}); running full snapshot set`);
  }
}

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

// Baseline states that must always be re-snapshotted: a snapshot with no
// baseline yet, or whose baseline failed/was rejected, cannot be safely skipped
// by server-side selection.
const FORCE_RESNAPSHOT_STATES = new Set(['failed', 'rejected']);

export async function applyIntelliStory(percy, snapshots, intelliStoryConfig, buildDir) {
  const log = logger('storybook:intelliStory');
  const { baseline, untraced, bailOnChanges, statsFile } = intelliStoryConfig || {};

  if (!buildDir) {
    throw new IntelliStoryBailError('IntelliStory requires the Storybook build directory (e.g. `percy storybook ./storybook-static`); URL and `start` modes are not supported. Running full snapshot set');
  }

  // The graph is keyed by the real Percy build id. The build is created up
  // front for IntelliStory runs (see @percy/storybook); if it is not present
  // (e.g. a dry run, or build creation failed) there is nothing to key on.
  const buildId = percy.build?.id;
  if (!buildId) {
    throw new IntelliStoryBailError('IntelliStory: Percy build was not created (dry run or build creation failed); running full snapshot set');
  }

  const projectRoot = gitProjectRoot();

  const { files, modules } = await validateAndReadStats(buildDir, statsFile, projectRoot, log);

  let { baseRef, affectedNodes, baselineSnapshots } = await getBaselineAndAffectedNodes(percy, baseline, log);

  assertNoDotStorybookChange(affectedNodes);
  assertNoBailOnChanges(affectedNodes, bailOnChanges);
  affectedNodes = enforceUntraced(affectedNodes, untraced);

  const packageAffectedNodes = await getAffectedPackages(affectedNodes, baseRef, projectRoot, log);

  if (!affectedNodes.length && !packageAffectedNodes.length) {
    throw new IntelliStoryBailError('IntelliStory: no affected files or packages detected after filtering; running full snapshot set');
  }

  const dotPosix = './';
  const dotPlatform = `.${path.sep}`;
  const invocationDir = process.cwd();
  const normalizeImportPath = p => {
    if (typeof p !== 'string' || !p) return p;
    let rel = p;
    /* istanbul ignore next */
    if (rel.startsWith(dotPlatform)) rel = rel.slice(dotPlatform.length);
    else if (rel.startsWith(dotPosix)) rel = rel.slice(dotPosix.length);
    const abs = path.resolve(invocationDir, rel); // nosemgrep
    const projRel = path.relative(projectRoot, abs);
    /* istanbul ignore next */
    return projRel || rel;
  };

  const storybookPaths = extractStorybookPaths(snapshots, normalizeImportPath, log);

  /* istanbul ignore next */
  if (packageAffectedNodes.length) {
    affectedNodes = [...affectedNodes, ...packageAffectedNodes];
  }

  const affectedFileLocations = getAffectedFileLocations(baseRef, files);

  // Enqueue the affected-story graph against the Percy build. Snapshot
  // selection now happens server-side (when snapshots are posted), so we no
  // longer read affected_stories back here or write the trace — we only kick
  // off generation and surface a failure by bailing to the full set.
  await runGraphGeneration(percy, buildId, { files, modules, storybookPaths, affectedNodes, affectedFileLocations }, log);

  // A snapshot that must be force re-snapshotted (no baseline yet, or a
  // failed/rejected baseline, when no explicit baseline is set) has IntelliStory
  // disabled so the API never selects it out — it is always captured.
  const needsBaselineRefresh = name => {
    if (baseline) return false;
    const state = baselineSnapshots?.[name];
    return state === undefined || FORCE_RESNAPSHOT_STATES.has(state);
  };

  // Tag every snapshot with `intelliStory` and its normalized `storybookPath`
  // so the API can perform affected-story selection when each is posted.
  return snapshots.map(s => ({
    ...s,
    intelliStory: !needsBaselineRefresh(s.name),
    storybookPath: normalizeImportPath(s.importPath)
  }));
}

// Called after the build has been finalized. At that point the graph job's
// data (vertices/edges/transitive closure) is available from job status, so we
// fetch it once more and write the trace when `trace` is enabled.
export async function writeIntelliStoryTrace(percy, intelliStoryConfig, log = logger('storybook:intelliStory')) {
  const { trace } = intelliStoryConfig || {};
  if (!trace) return;

  const buildId = percy.build?.id;
  if (!buildId) return;

  log.debug(`IntelliStory: fetching finalized graph data for build ${buildId} to write trace`);
  const { status, data } = await pollGraphStatus(percy, buildId, log);
  if (status !== 'done') {
    log.debug(`IntelliStory: graph status "${status ?? 'timed out'}" after finalize; skipping trace`);
    return;
  }

  maybeWriteTrace(trace, data, log);
}
