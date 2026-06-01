import { createRequire } from 'module';
import logger from '@percy/logger';

// snyk-nodejs-lockfile-parser is a CommonJS optionalDependency. It requires
// Node >=18 while the CLI supports Node >=14, so we defer the require to call
// time — that way importing this module never throws on older Node versions
// (or when the optional install was skipped for any other reason). Cached on
// first successful load so the require only resolves once per process.
const require = createRequire(import.meta.url);
let _snykModule;
function loadSnyk() {
  if (_snykModule) return _snykModule;
  try {
    _snykModule = require('snyk-nodejs-lockfile-parser');
    return _snykModule;
  } catch (e) {
    // Surface the underlying require failure so callers can distinguish
    // "not installed" (engine mismatch / optional skip) from genuine parse
    // failures that happen later inside buildDepTree.
    const err = new Error(`snyk-nodejs-lockfile-parser is not available (requires Node >=18, or the optional install was skipped): ${e.message}`);
    err.code = 'SNYK_LOCKFILE_PARSER_UNAVAILABLE';
    throw err;
  }
}

// Map the on-disk filename to snyk's LockfileType enum key. We can't resolve
// the enum value at module-eval time because the snyk import is deferred, so
// we look up the value inside diffLockfileDeps after loadSnyk() runs.
const TYPE_KEY_BY_FILENAME = {
  'package-lock.json': 'npm',
  'yarn.lock': 'yarn',
  'pnpm-lock.yaml': 'pnpm'
};

// Walk snyk's PkgTree (a recursive `{ name, version, dependencies: { ... } }`
// structure) into a flat `Map<name, version>` of every resolved package.
// We dedupe by name on first sight — multiple versions of the same package
// in the tree get collapsed to the first one encountered, which is fine for
// the diff because we only care about whether *something* about the package
// changed between old and new.
function flattenPkgTree(tree) {
  const out = new Map();
  const walk = node => {
    if (!node?.dependencies) return;
    for (const [name, child] of Object.entries(node.dependencies)) {
      if (!out.has(name)) out.set(name, child.version);
      walk(child);
    }
  };
  walk(tree);
  return out;
}

// Pull `{ name -> rangeString }` from a raw package.json's `dependencies`
// and `peerDependencies` blocks. devDeps and optionalDeps are intentionally
// excluded — only runtime-relevant top-level packages count. Returns {} on
// parse failure so the diff falls through to lockfile-only signal.
function topLevelDeps(packageJsonContents) {
  try {
    const pkg = JSON.parse(packageJsonContents);
    return {
      ...(pkg.dependencies || {}),
      ...(pkg.peerDependencies || {})
    };
  } catch {
    return {};
  }
}

// Given the project's package.json plus the old and new lockfile contents,
// return the set of package names that were added, removed, or version-bumped.
// Results are restricted to packages declared at the top level (dependencies
// or peerDependencies) of either old or new package.json — transitives ride
// along on direct-dep bumps and the BE module graph already resolves them
// from stats `imports[]`, so surfacing them here would just be noise.
//
// Two complementary diffs run, both gated by top-level names:
//   1. Resolved-version diff over the snyk PkgTree — catches lockfile entries
//      whose version actually changed.
//   2. Range-string diff over package.json — catches the case where a user
//      bumped `^5.8.3` to `^5.18.0` but the lockfile already resolved to
//      5.18.0 under the old range, so the resolved tree looks identical.
export async function diffLockfileDeps({ packageJson, oldPackageJson, oldLockfile, newLockfile, lockfileType }) {
  const log = logger('storybook:smartsnap:lockfile');

  // Validate the filename maps to a supported lockfile type BEFORE loading the
  // optional snyk parser. The parser requires Node >=18, so on older runtimes
  // (or when the optional install was skipped) an unsupported type must still
  // fail with this clear error rather than the parser-unavailable error from
  // loadSnyk(). This filename check needs no parser to run.
  const typeKey = TYPE_KEY_BY_FILENAME[lockfileType];
  if (!typeKey) {
    throw new Error(`Unsupported lockfile type: ${lockfileType}`);
  }

  const { buildDepTree, LockfileType } = loadSnyk();
  const type = LockfileType[typeKey];
  if (!type) {
    throw new Error(`Unsupported lockfile type: ${lockfileType}`);
  }

  // The two buildDepTree calls are kept sequential (not Promise.all'd) so that
  // when one of them throws the log message identifies *which* side failed —
  // old vs. new lockfile parsing behave differently when the user's lockfile
  // is in an unexpected state.
  let oldTree;
  try {
    log.debug('buildDepTree: parsing OLD lockfile...');
    oldTree = await buildDepTree(oldPackageJson, oldLockfile, true, type);
    log.debug('buildDepTree: OLD lockfile parsed successfully');
  } catch (e) {
    log.warn(`buildDepTree: OLD lockfile failed to parse: ${e.message}`);
    throw e;
  }

  let newTree;
  try {
    log.debug('buildDepTree: parsing NEW lockfile...');
    newTree = await buildDepTree(packageJson, newLockfile, true, type);
    log.debug('buildDepTree: NEW lockfile parsed successfully');
  } catch (e) {
    log.warn(`buildDepTree: NEW lockfile failed to parse: ${e.message}`);
    throw e;
  }

  const oldPkgs = flattenPkgTree(oldTree);
  const newPkgs = flattenPkgTree(newTree);

  const oldTopLevel = topLevelDeps(oldPackageJson);
  const newTopLevel = topLevelDeps(packageJson);
  const topLevelNames = new Set([...Object.keys(oldTopLevel), ...Object.keys(newTopLevel)]);

  const affected = new Set();
  for (const [name, version] of newPkgs) {
    if (!topLevelNames.has(name)) continue;
    if (!oldPkgs.has(name) || oldPkgs.get(name) !== version) affected.add(name);
  }
  for (const [name] of oldPkgs) {
    if (!topLevelNames.has(name)) continue;
    if (!newPkgs.has(name)) affected.add(name);
  }

  // Range-string diff is inherently top-level since it iterates package.json
  // directly. `!==` between the strings (or undefined) covers added, removed,
  // and changed in a single comparison.
  for (const name of topLevelNames) {
    if (oldTopLevel[name] !== newTopLevel[name]) affected.add(name);
  }

  return [...affected];
}
