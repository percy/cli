module.exports = async config => {
  const rollup = await import('./rollup.config.js');

  return config.set({
    basePath: process.cwd(),
    frameworks: ['jasmine'],
    reporters: ['mocha'],
    singleRun: true,
    concurrency: 1,

    // Karma + karma-firefox-launcher on windows-latest occasionally exits
    // with `Disconnected (0 times) Client disconnected from CONNECTED state
    // (server shutting down)` after every spec passes — the post-test
    // disconnect handshake misses Karma's default 2 s window. Generous
    // timeouts and a single tolerated disconnect prevent the runner-level
    // race from masquerading as a test failure.
    browserDisconnectTimeout: 30000,
    browserNoActivityTimeout: 60000,
    browserDisconnectTolerance: 1,
    captureTimeout: 60000,

    browsers: [
      'ChromeHeadless',
      'FirefoxHeadless'
    ],

    files: [
      // common files
      { pattern: require.resolve('regenerator-runtime/runtime'), watched: false },
      { pattern: require.resolve('./scripts/test-helpers'), type: 'module', watched: false },
      // local package files
      { pattern: 'src/index.js', type: 'module', watched: false },
      { pattern: 'test/helpers.js', type: 'module', watched: false },
      { pattern: 'test/**/*.test.js', type: 'module', watched: false },
      { pattern: 'test/assets/**', watched: false, included: false }
    ],
// NOTE: Although sdk-utils test run in browser as well, we do not run sdk-utils/request test in browsers as we require creation of https server for this test
    // NOTE: proxy.test.js is excluded because proxy functionality uses Node.js-specific modules (http, https)
    exclude: [
      '**/test/request.test.js',
      '**/test/proxy.test.js',
    ],
    proxies: {
      // useful when the contents of a fake asset do not matter
      '/_/': 'localhost/'
    },

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
};
