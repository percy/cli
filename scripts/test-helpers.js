/* eslint-env jasmine */
/* eslint-disable import/no-extraneous-dependencies */
const env = jasmine.getEnv();

beforeAll(() => {
  // default timeout to 10s
  if (process.platform === 'win32') {
    jasmine.DEFAULT_TIMEOUT_INTERVAL = 25000;
  } else {
    jasmine.DEFAULT_TIMEOUT_INTERVAL = 10000;
  }

  // allow re-spying
  env.allowRespy(true);

  // add or patch missing or broken matchers
  jasmine.addMatchers({
    // If any property within the path is not defined, it will show a failure rather than error
    // about accessing a property of an undefined value.
    toHaveProperty: util => ({
      compare(object, path, expected) {
        let value = path.split('.').reduce((v, k) => v && v[k], object);
        let pass = typeof expected === 'undefined'
          ? typeof value !== 'undefined'
          : util.equals(value, expected);
        let message = `Expected ${util.pp(path)} to ` + (
          !pass ? `equal ${util.pp(expected)}, but was ${util.pp(value)}`
            : `not equal ${util.pp(value)}`);
        return { pass, message };
      }
    }),

    // Jasmine's #contain util tries to be compatible with IE; so it purposefully doesn't handle
    // containing equal Set items. This matcher overwrites the #toContain matcher to allow it to
    // handle Sets in a more modern way.
    toContain: util => ({
      compare(haystack, needle) {
        let pass = false;

        if (typeof haystack === 'string') {
          pass = haystack.includes(needle);
        } else {
          for (let item of haystack) {
            if (util.equals(item, needle)) pass = true;
            if (pass) break;
          }
        }

        return { pass };
      }
    })
  });
});

// dump logs for failed tests when debugging
const { DUMP_FAILED_TEST_LOGS } = (
  typeof window !== 'undefined'
    ? window.__karma__.config.env
    : process.env
);

if (DUMP_FAILED_TEST_LOGS) {
  // add a spec reporter to dump failed logs
  env.addReporter({
    specDone: async ({ status }) => {
      let logger = typeof window !== 'undefined'
        ? (window.PercyLogger && window.PercyLogger.TestHelpers) ||
          (window.PercySDKUtils && window.PercySDKUtils.TestHelpers.logger)
        : (await import('@percy/logger/test/helpers')).logger;
      if (logger && status === 'failed') logger.dump();
    }
  });
}
