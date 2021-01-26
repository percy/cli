module.exports = config => {
  config.set({
    frameworks: ['mocha'],

    browsers: [
      'ChromeHeadless',
      'FirefoxHeadless'
    ],

    reporters: [
      'mocha',
      'coverage'
    ],

    files: [
      { pattern: 'src/index.js', watched: false },
      { pattern: 'test/helpers.js', watched: false },
      { pattern: 'test/**/*.test.js', watched: false }
    ],

    preprocessors: {
      'src/index.js': ['rollup'],
      'test/helpers.js': ['rollupTestHelpers'],
      'test/**/*.test.js': ['rollupTest']
    },

    mochaReporter: {
      showDiff: true
    },

    coverageReporter: {
      type: process.env.COVERAGE || 'none',
      check: process.env.COVERAGE && {
        global: {
          statements: 100,
          lines: 100,
          functions: 100,
          branches: 100
        }
      }
    },

    rollupPreprocessor: {
      plugins: [
        require('@rollup/plugin-node-resolve').default(),
        require('@rollup/plugin-commonjs')(),
        require('@rollup/plugin-babel').default({
          babelHelpers: 'inline'
        })
      ],
      output: {
        format: 'umd',
        exports: 'named',
        name: 'PercyDOM',
        sourcemap: 'inline'
      },
      onwarn: message => {
        if (/circular dependency/i.test(message)) return;
        console.warn(message);
      }
    },

    customPreprocessors: {
      rollupTestHelpers: {
        base: 'rollup',
        options: {
          output: {
            name: 'TestHelpers',
            format: 'iife',
            exports: 'named',
            sourcemap: 'inline'
          }
        }
      },

      rollupTest: {
        base: 'rollup',
        options: {
          external: [
            '@percy/dom',
            'test/helpers'
          ],
          output: {
            name: 'Tests',
            format: 'iife',
            sourcemap: 'inline',
            globals: {
              '@percy/dom': 'PercyDOM',
              'test/helpers': 'TestHelpers'
            }
          }
        }
      }
    },

    plugins: [
      'karma-chrome-launcher',
      'karma-firefox-launcher',
      'karma-coverage',
      'karma-mocha',
      'karma-mocha-reporter',
      'karma-rollup-preprocessor'
    ]
  });
};
