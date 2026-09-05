import fs from 'fs';
import url from 'url';
import path from 'path';

export const ROOT = path.resolve(url.fileURLToPath(import.meta.url), '../..');

// Matches and rewrites internal imports into absolute src paths.
//
// Kept in its own module, deliberately free of side effects: rollup.config.js
// (and karma.config.cjs, transitively) import LOADER_ALIAS in the MAIN thread,
// while loader.js is a module-customization-hooks entry that Node runs on a
// dedicated worker. Importing the hooks module just to read a regex used to
// install a global Proxy as a side effect of every rollup and karma run.
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
