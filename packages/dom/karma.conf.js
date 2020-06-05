module.exports = config => {
  config.set({
    frameworks: ['mocha'],
    browsers: ['ChromeHeadless'],

    reporters: [
      'mocha',
      'coverage'
    ],

    files: [
      { pattern: 'test/index.js', watched: false }
    ],

    preprocessors: {
      'test/index.js': ['webpack']
    },

    mochaReporter: {
      showDiff: true
    },

    coverageReporter: {
      type: config.coverage === true ? 'text'
        : (config.coverage || 'none'),
      check: {
        global: {
          statements: 100,
          lines: 100,
          functions: 100,
          branches: 100
        }
      }
    },

    webpack: {
      mode: 'development',
      module: require('./webpack.config').module,
      externals: {
        // referenced by jest expect
        fs: '{}',
        module: '{}'
      }
    },

    webpackMiddleware: {
      stats: 'minimal'
    },

    plugins: [
      'karma-chrome-launcher',
      'karma-firefox-launcher',
      'karma-coverage',
      'karma-mocha',
      'karma-mocha-reporter',
      'karma-webpack'
    ]
  });
};
