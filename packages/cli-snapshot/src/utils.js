import picomatch from 'picomatch';

// used to deserialize regular expression strings
const RE_REGEXP = /^\/(.+)\/(\w+)?$/;

// Throw a better error message for invalid urls
export function validURL(url, base) {
  try { return new URL(url, base); } catch (e) {
    throw new Error(`Invalid URL: ${e.input}`);
  }
}

// Mutates an options object to have normalized and default values
export function withDefaults(options, { host }) {
  // allow URLs as the only option
  if (typeof options === 'string') options = { url: options };

  // validate URLs
  let url = validURL(options.url, host);

  // default name to the url path
  options.name ||= `${url.pathname}${url.search}${url.hash}`;
  // normalize the snapshot url
  options.url = url.href;

  return options;
}

// Returns true or false if a snapshot matches the provided include and exclude predicates. A
// predicate can be an array of predicates, a regular expression, a glob pattern, or a function.
export function snapshotMatches(snapshot, include, exclude) {
  if (!include && !exclude) return true;

  let test = (predicate, fallback) => {
    if (predicate && typeof predicate === 'string') {
      // snapshot matches a glob
      let result = picomatch(predicate, { basename: true })(snapshot.name);

      // snapshot might match a string pattern
      if (!result) {
        try {
          let [, parsed = predicate, flags] = RE_REGEXP.exec(predicate) || [];
          result = new RegExp(parsed, flags).test(snapshot.name);
        } catch {}
      }

      return result;
    } else if (predicate instanceof RegExp) {
      // snapshot matches a regular expression
      return predicate.test(snapshot.name);
    } else if (typeof predicate === 'function') {
      // advanced matching
      return predicate(snapshot);
    } else if (Array.isArray(predicate) && predicate.length) {
      // array of predicates
      return predicate.some(p => test(p));
    } else {
      // default fallback
      return fallback;
    }
  };

  // not excluded or explicitly included
  return !test(exclude, false) && test(include, true);
}
