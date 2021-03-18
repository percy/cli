const cwd = process.cwd();
const rollup = require('./rollup.config');

module.exports = config => config.set({
  basePath: cwd,
  singleRun: true,
  frameworks: ['jasmine'],
  reporters: ['mocha'],

  browsers: [
    'ChromeHeadless',
    'FirefoxHeadless'
  ],

  files: [
    // common files
    { pattern: require.resolve('regenerator-runtime/runtime'), watched: false },
    { pattern: require.resolve('./scripts/test-helpers'), watched: false },
    // local package files
    { pattern: 'src/index.js', watched: false },
    { pattern: 'test/helpers.js', watched: false },
    { pattern: 'test/**/*.test.js', watched: false }
  ],

  // create dedicated bundles for src, test helpers, and each test suite
  preprocessors: {
    'src/index.js': ['rollup'],
    'test/helpers.js': ['rollupTestHelpers'],
    'test/**/*.test.js': ['rollupTestFiles']
  },

  client: {
    env: {
      // used in the test helper to add failed test debug logs
      DUMP_FAILED_TEST_LOGS: process.env.DUMP_FAILED_TEST_LOGS
    },
    // reports look better when not randomized
    jasmine: {
      random: false
    }
  },

  // (see rollup.config.js)
  rollupPreprocessor: rollup.test,

  customPreprocessors: {
    rollupTestHelpers: {
      base: 'rollup',
      options: rollup.testHelpers
    },
    rollupTestFiles: {
      base: 'rollup',
      options: rollup.testFiles
    }
  },

  plugins: [
    'karma-chrome-launcher',
    'karma-firefox-launcher',
    'karma-jasmine',
    'karma-mocha-reporter',
    'karma-rollup-preprocessor'
  ]
});
