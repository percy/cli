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
export async function resolve(specifier, context, defaultResolve) {
  // check for import or filesystem mocks
  if (MOCK_IMPORTS.has(specifier)) {
    return { url: `mock://${specifier}?__mock__=${MOCK_IMPORTS.__uid__}&module` };
  } else if (context.parentURL && '$vol' in fs) {
    let filename = specifier.startsWith('file:') ? url.fileURLToPath(specifier) : specifier;
    let filepath = path.resolve(path.dirname(url.fileURLToPath(context.parentURL)), filename);

    if (fs.$vol.existsSync(filepath)) {
      let fmt = CJS_REG.test(fs.$vol.readFileSync(filepath)) ? 'commonjs' : 'module';
      return { url: `${url.pathToFileURL(filepath)}?__mock__=${MOCK_IMPORTS.__uid__}&${fmt}` };
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

  // use default resolve when not mocked
  return defaultResolve(specifier, context, defaultResolve);
}

// get module format for loader mocks
export async function getFormat(srcURL, context, defaultGetFormat) {
  return srcURL.includes('?__mock__')
    ? { format: srcURL.split('?')[1].split('&')[1] }
    : defaultGetFormat(srcURL, context, defaultGetFormat);
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

// return loader mocks as module sources
export async function getSource(srcURL, context, defaultGetSource) {
  if (srcURL.includes('?__mock__')) return { source: mockSource(srcURL) };
  return defaultGetSource(srcURL, context, defaultGetSource);
}

// return loader mocks or transform sources using babel
export async function transformSource(source, context, defaultTransformSource) {
  let callback = (src = source) => defaultTransformSource(src, context, defaultTransformSource);
  if (context.format !== 'module' && context.format !== 'commonjs') return callback();
  if (context.url.startsWith('mock://')) return callback();

  if (typeof source !== 'string') source = Buffer.from(source);
  if (Buffer.isBuffer(source)) source = source.toString();

  return callback((await babel.transformAsync(source, {
    filename: url.fileURLToPath(context.url),
    sourceType: context.format,
    babelrcRoots: ['.'],
    rootMode: 'upward',
    only: [BABEL_REG]
  }))?.code);
}
