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
    { pattern: 'test/helper*(s).js', watched: false },
    { pattern: 'test/**/*.test.js', watched: false }
  ],

  // create dedicated bundles for src, test helpers, and each test suite
  preprocessors: {
    'src/index.js': ['rollup'],
    'test/helper*(s).js': ['rollupTestHelpers'],
    'test/**/*.test.js': ['rollupTestFiles']
  },

  // reports look better when not randomized
  client: {
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
