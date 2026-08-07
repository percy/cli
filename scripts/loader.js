import fs from 'fs';
import url from 'url';
import path from 'path';
import babel from '@babel/core';

const ROOT = path.resolve(url.fileURLToPath(import.meta.url), '../..');
const BABEL_REG = /(\/|\\)(@percy|packages)\1(.+?)\1(src|test|.*\\.js)/;
const CJS_REG = /(^|\n)(module\.)?(exports)/;
const MOCK_REG = /^mock:\/\/|\?.+$/g;

// global mocks can be added from tests
export const MOCK_IMPORTS = global.__MOCK_IMPORTS__ = global.__MOCK_IMPORTS__ ||
  new Proxy(Object.assign(new Map(), { __uid__: 0 }), {
    get(target, prop, receiver) {
      if (typeof target[prop] !== 'function') return target[prop];

      return prop === 'set' ? (key, value) => {
        return target[prop](key, (target.__uid__++, value));
      } : (prop === 'get' || prop === 'has') ? key => {
        return target[prop](key.replace(MOCK_REG, ''));
      } : target[prop].bind(target);
    }
  });

// matches and rewrites internal imports into absolute src paths
export const LOADER_ALIAS = {
  find: /^@percy\/([^/]+)(?:\/(.+))?$|(^[./]+?)\/dist\/(.+\.js)$/,
  replace: (specifier, name, subpath, rel, filename) => {
    if (rel) return `${rel}/src/${filename}`;
    if (!subpath) return path.resolve(ROOT, `./packages/${name}/src/index.js`);
    let pkg = JSON.parse(fs.readFileSync(path.join(ROOT, `./packages/${name}/package.json`)));
    let alias = pkg.exports?.[`./${subpath}`].replace('./dist', './src');
    if (alias) return path.resolve(ROOT, `./packages/${name}/${alias}`);
    return specifier;
  }
};

// resolve specifier file url
export function resolve(specifier, context, nextResolve) {
  // `module.registerHooks` intercepts require() as well as import, which the
  // old --experimental-loader did not. Mock interception has to stay
  // import-only: applying it to require() redirects internal CommonJS requires
  // into the memfs volume and breaks fs mocking (@percy/config).
  let isRequire = context.conditions?.includes('require');

  // check for import or filesystem mocks
  if (!isRequire && MOCK_IMPORTS.has(specifier)) {
    return {
      url: `mock://${specifier}?__mock__=${MOCK_IMPORTS.__uid__}&module`,
      shortCircuit: true
    };
  } else if (!isRequire && context.parentURL && '$vol' in fs) {
    let filename = specifier.startsWith('file:') ? url.fileURLToPath(specifier) : specifier;
    let filepath = path.resolve(path.dirname(url.fileURLToPath(context.parentURL)), filename);

    if (fs.$vol.existsSync(filepath)) {
      let fmt = CJS_REG.test(fs.$vol.readFileSync(filepath)) ? 'commonjs' : 'module';

      return {
        url: `${url.pathToFileURL(filepath)}?__mock__=${MOCK_IMPORTS.__uid__}&${fmt}`,
        shortCircuit: true
      };
    }
  }

  // rewrite dist to src in development
  let original = specifier;

  if (specifier.startsWith('#')) {
    let pkgRoot = url.fileURLToPath(context.parentURL.replace(/(packages\/[^/]+\/).+$/, '$1'));
    let pkgJSON = JSON.parse(fs.readFileSync(path.resolve(pkgRoot, 'package.json')));
    let alias = pkgJSON.imports[specifier]?.node?.replace('./dist', './src');
    if (alias) specifier = path.resolve(pkgRoot, alias);
  } else {
    specifier = specifier.replace(LOADER_ALIAS.find, LOADER_ALIAS.replace);
  }

  // Transform absolute filepaths into absolute file urls, but only for
  // specifiers we actually rewrote. `module.registerHooks` also intercepts
  // `require()`, whose resolver rejects a file: URL -- converting every
  // in-repo path unconditionally broke requires like babel.config.cjs.
  if (specifier !== original && specifier.startsWith(ROOT)) {
    specifier = url.pathToFileURL(specifier).href;
  }

  // use default resolve when not mocked
  return nextResolve(specifier, context);
}

// generate mock sources for mocked modules
function mockSource(mockURL) {
  if (MOCK_IMPORTS.has(mockURL)) {
    let key = `global.__MOCK_IMPORTS__.get("${mockURL}")`;

    return Object.keys(MOCK_IMPORTS.get(mockURL)).reduce((src, name) => src + (
      `export ${name === 'default' ? name : `const ${name} =`} ${key}.${name};\n`
    ), '');
  } else {
    return fs.$vol.readFileSync(url.fileURLToPath(mockURL));
  }
}

// Nearest package.json `type`, mirroring how babel.config.cjs decides between
// its `modules: false` and `modules: 'commonjs'` overrides. The format we hand
// back to Node has to agree with what Babel actually emitted, so it is derived
// the same way rather than sniffed off the output.
const typeCache = new Map();

function packageType(filename) {
  let dir = path.dirname(filename);

  while (dir.startsWith(ROOT)) {
    if (typeCache.has(dir)) return typeCache.get(dir);
    let pkg = path.join(dir, 'package.json');

    if (fs.existsSync(pkg)) {
      let type = JSON.parse(fs.readFileSync(pkg, 'utf8')).type === 'module'
        ? 'module' : 'commonjs';
      typeCache.set(dir, type);
      return type;
    }

    let parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  return 'commonjs';
}

// Read a module's source directly, for the cases where Node does not hand
// `source` to the load hook (notably CommonJS).
//
// Deliberately uses the real filesystem via realpath-free readFileSync on the
// *unspied* binding: while a test has fs mocked, `fs.readFileSync` is a jasmine
// spy backed by memfs, so reading through it would serve in-memory content for
// ordinary source files. Memfs-backed modules are handled separately, via the
// `?__mock__` branch in load().
const realReadFileSync = fs.readFileSync;

function readSource(loadURL) {
  return realReadFileSync(url.fileURLToPath(loadURL.split('?')[0]), 'utf8');
}

// Return loader mocks, or transform sources using babel.
//
// Replaces the getFormat/getSource/transformSource trio this file used to
// export. Those hooks were removed in Node 16.12 and silently stopped being
// called, which is what pinned the suite to Node 14: without the Babel step
// the test files load as native ESM (frozen namespaces, no `__dirname`), and
// without a shared realm the `__MOCK_IMPORTS__` interception never matched.
// A single synchronous `load` registered via `module.registerHooks` restores
// both behaviours. See scripts/loader-register.js.
export function load(loadURL, context, nextLoad) {
  // synthesized mock module, or a memfs-backed file
  if (loadURL.includes('?__mock__')) {
    let format = loadURL.split('?')[1].split('&')[1];
    let source = mockSource(loadURL);

    // `mock://` modules are generated re-export shims and must be left alone,
    // but memfs-backed files are real sources -- the old transformSource hook
    // skipped only the former, so keep transforming the latter.
    if (!loadURL.startsWith('mock://')) {
      source = transform(source, url.fileURLToPath(loadURL.split('?')[0]), format) ?? source;
    }

    return { format, source, shortCircuit: true };
  }

  let result = nextLoad(loadURL, context);
  let format = result.format ?? context.format;

  // only our own src/test files get transformed
  if (format !== 'module' && format !== 'commonjs') return result;
  if (!loadURL.startsWith('file:')) return result;

  let filename = url.fileURLToPath(loadURL.split('?')[0]);
  if (!BABEL_REG.test(filename)) return result;

  let source = result.source;

  if (source == null) {
    try { source = readSource(loadURL); } catch { return result; }
  }

  let transformed = transform(source, filename, format);

  // `only` misses turn into a null result -- keep Node's original module.
  if (transformed == null) return result;

  return {
    format: packageType(filename),
    source: transformed,
    shortCircuit: true
  };
}

// Babel-transform a module source, or return null when Babel's `only` filter
// does not match it. `unambiguous` lets Babel classify the input itself; the
// old code forwarded Node's format, but Babel's sourceType has no 'commonjs'
// member, so a CommonJS file would have been mis-declared.
function transform(source, filename, format) {
  if (typeof source !== 'string') source = Buffer.from(source).toString('utf8');

  return babel.transformSync(source, {
    filename,
    sourceType: 'unambiguous',
    babelrcRoots: ['.'],
    rootMode: 'upward',
    only: [BABEL_REG]
  })?.code ?? null;
}
