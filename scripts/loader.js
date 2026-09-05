// Hooks-thread half of the test module-customization harness.
//
// Node >=18.19/20 runs these on a dedicated worker, so nothing here can reach
// main-thread state. register-hooks.mjs mirrors what we need onto the real
// filesystem; we read that manifest synchronously (allowed, and cheap).
//
// Replaces the pre-16.12 getFormat/getSource/transformSource trio, which Node
// now ignores with a warning rather than an error — which is why dropping them
// silently disabled coverage instead of failing loudly.
import fs from 'fs';
import url from 'url';
import path from 'path';
import babel from '@babel/core';
import { ROOT, LOADER_ALIAS } from './loader-alias.js';

const BABEL_REG = /(\/|\\)(@percy|packages)\1(.+?)\1(src|test|.*\\.js)/;

let MANIFEST_PATH;

export async function initialize(data) {
  MANIFEST_PATH = data?.manifestPath;
}

const EMPTY = { uid: 0, mocks: {}, files: {} };

function manifest() {
  if (!MANIFEST_PATH) return EMPTY;

  try {
    return JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  } catch {
    // absent, or caught mid-rename — treat as empty rather than failing every
    // resolution in the process
    return EMPTY;
  }
}

function toPath(specifier) {
  try {
    return specifier.startsWith('file:') ? url.fileURLToPath(specifier) : specifier;
  } catch {
    return null;
  }
}

export async function resolve(specifier, context, nextResolve) {
  let mocks = manifest();

  // registry mocks — source is synthesized in load()
  if (Object.prototype.hasOwnProperty.call(mocks.mocks, specifier)) {
    // The specifier is percent-encoded into a single path segment because some
    // keys are themselves file:// URLs (see mockLegacyCommands). Interpolating
    // one raw yields `mock://file:///…`, which is not a parseable URL — the new
    // hooks API validates the returned url and rejects it, where the pre-16.12
    // API did not.
    return {
      url: `mock:///${encodeURIComponent(specifier)}?__mock__=${mocks.uid}`,
      format: 'module',
      shortCircuit: true
    };
  }

  // virtual modules written into the memfs volume, resolved to the real copy
  // register-hooks.mjs materialised for us
  if (context.parentURL && Object.keys(mocks.files).length) {
    let filename = toPath(specifier);
    let parent = toPath(context.parentURL);

    if (filename && parent) {
      let entry = mocks.files[path.resolve(path.dirname(parent), filename)];

      if (entry) {
        return {
          url: `${url.pathToFileURL(entry.real).href}?__mock__=${mocks.uid}&${entry.format}`,
          format: entry.format,
          shortCircuit: true
        };
      }
    }
  }

  // rewrite dist to src in development
  if (specifier.startsWith('#')) {
    let pkgRoot = url.fileURLToPath(context.parentURL.replace(/(packages\/[^/]+\/).+$/, '$1'));
    let pkgJSON = JSON.parse(fs.readFileSync(path.resolve(pkgRoot, 'package.json')));
    let alias = pkgJSON.imports[specifier]?.node?.replace('./dist', './src');
    if (alias) specifier = path.resolve(pkgRoot, alias);
  } else {
    specifier = specifier.replace(LOADER_ALIAS.find, LOADER_ALIAS.replace);
  }

  // transform absolute filepaths into absolute file urls
  if (specifier.startsWith(ROOT)) specifier = url.pathToFileURL(specifier).href;

  return nextResolve(specifier, context);
}

// The emitted shim reads values back out of global.__MOCK_IMPORTS__. That code
// runs in the MAIN thread, which is why only export *names* have to cross the
// thread boundary — the values never do.
function mockSource(mockURL) {
  let key = decodeURIComponent(new URL(mockURL).pathname.slice(1));
  let ref = `global.__MOCK_IMPORTS__.get(${JSON.stringify(key)})`;

  return (manifest().mocks[key] ?? []).map(name => (
    name === 'default'
      ? `export default ${ref}.default;`
      : `export const ${name} = ${ref}.${name};`
  )).join('\n') + '\n';
}

// Mirrors babel.config.cjs's own package-type lookup. That config picks
// `modules: false` vs `modules: 'commonjs'` purely from the nearest
// package.json's `type` field, so the loader has to agree with it — see load().
const pkgTypeCache = new Map();

// Returns 'module' or 'commonjs' when a package.json was actually found, and
// null when the walk found nothing. The distinction matters: "found, and it does
// not say module" is a CommonJS package, whereas "no package.json at all" means
// we know nothing and must not assume either way.
function nearestPackageType(filename) {
  let dir = path.dirname(filename);

  while (dir.startsWith(ROOT)) {
    if (pkgTypeCache.has(dir)) return pkgTypeCache.get(dir);
    let pkg = path.join(dir, 'package.json');

    if (fs.existsSync(pkg)) {
      let { type } = JSON.parse(fs.readFileSync(pkg, 'utf8'));
      let resolved = type === 'module' ? 'module' : 'commonjs';
      pkgTypeCache.set(dir, resolved);
      return resolved;
    }

    let parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  return null;
}

export async function load(loadURL, context, nextLoad) {
  if (loadURL.startsWith('mock://')) {
    return { format: 'module', source: mockSource(loadURL), shortCircuit: true };
  }

  let result = await nextLoad(loadURL, context);
  if (result.format !== 'module' && result.format !== 'commonjs') return result;

  // Hand CommonJS packages straight back to Node's CJS loader, transforming
  // nothing here.
  //
  // Node 18 reported these as `format: 'commonjs'` with a null source, so the CJS
  // require path loaded them and @babel/register (wired in via jasmine's
  // `requires`) did the ESM->CJS transform. Node 20 reports the same file as
  // `module` and hands us its source, which tempted this hook into transforming
  // it and declaring the format Babel actually emitted.
  //
  // Returning a source for a CommonJS module makes Node load it as a distinct
  // module instead of going through the `require` cache, so a package imported
  // BOTH ways ends up with two live instances. @percy/sdk-utils is imported as
  // ESM by the specs and required as CJS by test/helpers.js: with two instances,
  // `delete utils.percy.enabled` in setupTest() mutated one object while
  // isPercyEnabled() read the other, so `percy.enabled` stayed cached, the
  // healthcheck was never re-issued, and 8 specs failed on stale state.
  //
  // Declaring the format without a source keeps a single shared instance and
  // leaves the transform to @babel/register, exactly as on Node 18.
  //
  // Scoped to files BABEL_REG matches (our own packages' src/test) and to
  // packages that positively declare themselves non-ESM. Applying it whenever
  // nearestPackageType() failed to answer would strip the source from genuinely
  // ESM files it knows nothing about — which broke cli, cli-build, cli-snapshot
  // and cli-upload the first time round.

  // strip the ?__mock__ cache-buster: fileURLToPath throws on a query string
  let filename = url.fileURLToPath(loadURL.split('?')[0]);

  if (BABEL_REG.test(filename) && nearestPackageType(filename) === 'commonjs') {
    return { ...result, format: 'commonjs', source: undefined, shortCircuit: true };
  }

  let source = result.source;
  if (Buffer.isBuffer(source)) source = source.toString();
  if (typeof source !== 'string') return result;

  let out = await babel.transformAsync(source, {
    filename,
    sourceType: result.format,
    babelrcRoots: ['.'],
    rootMode: 'upward',
    only: [BABEL_REG]
  });

  // transformAsync returns null when `only` excludes the file. The old
  // transformSource hook had a defaultTransformSource to fall through to;
  // load() does not, and returning { source: undefined } throws.
  if (!out?.code) return result;

  // Only ESM packages reach here (the CommonJS case returned above), so the
  // format Node reported is the one Babel emitted.
  return { ...result, source: out.code };
}
