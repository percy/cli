const fs = require('fs');
const os = require('os');
const path = require('path');

const cwd = process.cwd();
const pkg = require(`${cwd}/package.json`);
const dist = pkg.files?.map(f => path.join(cwd, f));

function getPackageJSON(rel) {
  let cache = getPackageJSON.cache = getPackageJSON.cache || new Map();
  if (cache.has(rel)) return cache.get(rel);
  let pkg = path.join(rel, 'package.json');
  let dir = path.dirname(rel);

  if (fs.existsSync(pkg)) {
    cache.set(rel, JSON.parse(fs.readFileSync(pkg)));
    return cache.get(rel);
  } else if (dir !== rel && dir !== os.homedir()) {
    return getPackageJSON(dir);
  }
}

module.exports = {
  overrides: [{
    test: name => dist?.includes(name) === false &&
      getPackageJSON(name).type === 'module',
    presets: [
      ['@babel/env', {
        modules: false,
        targets: { node: '14' }
      }]
    ]
  }, {
    test: name => dist?.includes(name) === false &&
      getPackageJSON(name).type !== 'module',
    presets: [
      ['@babel/env', {
        modules: 'commonjs',
        targets: { node: '14' }
      }]
    ]
  }, {
    test: (name, { envName }) => envName === 'test' &&
      getPackageJSON(name).type !== 'module',
    plugins: [
      ['module-resolver', {
        cwd: __dirname,
        alias: {
          '^@percy/((?!dom)[^/]+)$': './packages/\\1/src/index.js',
          '^@percy/([^/]+)/((?!test|src).+)$': './packages/\\1/src/\\2'
        }
      }]
    ]
  }],
  env: {
    test: {
      plugins: [
        ['istanbul', {
          exclude: ['dist', 'test']
        }]
      ]
    },
    dev: {
      presets: ["@babel/preset-env"],
      plugins: ["babel-plugin-transform-import-meta"]
    }
  }
};
