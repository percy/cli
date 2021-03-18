const pkg = require(`${process.cwd()}/package.json`);

const base = {
  ignore: pkg.files,
  presets: [
    ['@babel/env', {
      targets: {
        node: '12'
      }
    }]
  ],
  plugins: [
    '@babel/proposal-class-properties'
  ]
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
