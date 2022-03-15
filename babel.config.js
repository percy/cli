const cwd = process.cwd();
const path = require('path');
const pkg = require(`${cwd}/package.json`);

const base = {
  overrides: [{
    exclude: pkg.files && (
      pkg.files.map(f => (
        path.join(cwd, f)
      ))),
    presets: [
      ['@babel/env', {
        targets: {
          node: '12'
        }
      }]
    ]
  }]
};

const development = {
  plugins: [
    ['module-resolver', {
      cwd: __dirname,
      alias: {
        '^@percy/((?!dom)[^/]+)$': './packages/\\1/src',
        '^@percy/(.+)/dist/(.+)$': './packages/\\1/src/\\2'
      }
    }]
  ]
};

const test = {
  plugins: [
    ...development.plugins,
    ['istanbul', { exclude: ['dist', 'test'] }]
  ]
};

module.exports = {
  ...base,
  env: {
    development,
    test
  }
};
