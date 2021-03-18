const path = require('path');
const alias = require('@rollup/plugin-alias');
const babel = require('@rollup/plugin-babel').default;
const resolve = require('@rollup/plugin-node-resolve').default;
const commonjs = require('@rollup/plugin-commonjs');
const pkg = require(`${process.cwd()}/package.json`);

// ignore these warnings
const IGNORE_WARNINGS = [
  'CIRCULAR_DEPENDENCY',
  'MISSING_NODE_BUILTINS'
];

// easier to reference plugins in configs when defined in one place
const plugins = {
  alias: alias({
    entries: [{
      find: /^@percy\/([^/]+)$/,
      replacement: path.join(__dirname, '/packages/$1/src/index.js')
    }, {
      find: /^@percy\/([^/]+)\/dist\/(.+)$/,
      replacement: path.join(__dirname, '/packages/$1/src/$2')
    }]
  }),
  babel: babel({
    rootMode: 'upward',
    babelHelpers: 'bundled',
    presets: [
      ['@babel/env', {
        targets: 'last 2 version'
      }]
    ]
  }),
  commonjs: commonjs(),
  resolve: resolve({
    browser: true
  })
};

// default config used for production bundles
const base = {
  input: 'src/index.js',
  ...pkg.rollup,
  output: {
    format: 'umd',
    exports: 'named',
    file: pkg.browser,
    ...pkg.rollup.output,
    intro: [
      // provide the bundle with a fake process.env if needed
      'const process = (typeof globalThis !== "undefined" && globalThis.process) || {};',
      'process.env = process.env || {};',
      // signals that the package is running in a browserified bundle
      'process.env.__PERCY_BROWSERIFIED__ = true;'
    ].join('\n')
  },
  plugins: [
    plugins.alias,
    plugins.babel,
    plugins.commonjs
  ],
  onwarn: warning => {
    if (IGNORE_WARNINGS.includes(warning.code)) return;
    console.warn(warning);
  }
};

// used to match external bundles
const ENTRY_REG = /[/\\]src$/;
const BUILTINS_REG = /^(?:stream)(\/.+)?$/;
const TESTHELPERS_REG = /[/\\]test[/\\]helpers?(?:\.js)?$/;
const isLib = id => id === pkg.name || ENTRY_REG.test(id);

// test config used for test bundles
const test = {
  ...base,
  output: {
    ...base.output,
    file: null,
    sourcemap: 'inline',
    intro: [
      base.output.intro,
      // persist the fake process.env for testing
      'globalThis.process = globalThis.process || process;'
    ].join('\n')
  }
};

// test config used to bundle test helpers
const testHelpers = {
  external: id => (
    isLib(id) ||
    BUILTINS_REG.test(id)
  ),
  output: {
    ...test.output,
    format: 'umd',
    name: 'TestHelpers',
    globals: id => {
      if (isLib(id)) return pkg.rollup.output.name;
      if (BUILTINS_REG.test(id)) return 'null';
    }
  },
  plugins: [
    plugins.alias,
    plugins.resolve,
    plugins.commonjs,
    plugins.babel
  ]
};

// test config used to bundle test files
const testFiles = {
  external: id => (
    isLib(id) ||
    TESTHELPERS_REG.test(id)
  ),
  output: {
    ...test.output,
    format: 'iife',
    name: 'Tests',
    globals: id => {
      if (isLib(id)) return pkg.rollup.output.name;
      if (TESTHELPERS_REG.test(id)) return 'TestHelpers';
    }
  },
  plugins: [
    ...testHelpers.plugins
  ]
};

// export default bundle config
const bundles = [base];

module.exports.default = bundles;
module.exports.test = test;
module.exports.testHelpers = testHelpers;
module.exports.testFiles = testFiles;
