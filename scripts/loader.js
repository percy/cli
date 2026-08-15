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

function nearestPackageType(filename) {
  let dir = path.dirname(filename);

  while (dir.startsWith(ROOT)) {
    if (pkgTypeCache.has(dir)) return pkgTypeCache.get(dir);
    let pkg = path.join(dir, 'package.json');

    if (fs.existsSync(pkg)) {
      let { type } = JSON.parse(fs.readFileSync(pkg, 'utf8'));
      pkgTypeCache.set(dir, type);
      return type;
    }

    let parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  return undefined;
}

export async function load(loadURL, context, nextLoad) {
  if (loadURL.startsWith('mock://')) {
    return { format: 'module', source: mockSource(loadURL), shortCircuit: true };
  }

  let result = await nextLoad(loadURL, context);
  if (result.format !== 'module' && result.format !== 'commonjs') return result;

  let source = result.source;
  if (Buffer.isBuffer(source)) source = source.toString();
  if (typeof source !== 'string') return result;

  // strip the ?__mock__ cache-buster: fileURLToPath throws on a query string
  let filename = url.fileURLToPath(loadURL.split('?')[0]);

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

  // Declare the format Babel actually emitted, not the one Node guessed.
  //
  // Node 18 reported these files as `commonjs` with a null source, so the CJS
  // loader read them and @babel/register did the transform. Node 20 reports the
  // SAME file as `module` and hands us its source — but babel.config.cjs keys
  // off the nearest package.json's `type`, so for a package without
  // `"type": "module"` (e.g. @percy/sdk-utils) it still compiles ESM down to
  // CommonJS. Passing that CJS output back as `module` makes Node parse
  // `exports.x = …` as an ES module, and every export silently disappears:
  //   SyntaxError: The requested module '@percy/sdk-utils'
  //   does not provide an export named 'default'
  let format = nearestPackageType(filename) === 'module' ? 'module' : 'commonjs';

  return { ...result, format, source: out.code };
}
