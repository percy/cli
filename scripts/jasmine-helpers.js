/* eslint-env jasmine */

beforeAll(() => {
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
