import path from 'path';
import * as pathToRegexp from 'path-to-regexp';
import picomatch from 'picomatch';

// used to deserialize regular expression strings
const RE_REGEXP = /^\/(.+)\/(\w+)?$/;

// Throw a better error message for invalid urls
function validURL(url, base) {
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

// Serves a static directory with the provided options and returns an object containing adjusted
// rewrites (combined with any baseUrl), the server host, a close method, and the server
// instance. The `dry` option will prevent the server from actually starting.
export async function serve(dir, {
  dry,
  baseUrl,
  cleanUrls,
  rewrites = {}
}) {
  let host = 'http://localhost';

  // reduce rewrite options with any base-url
  rewrites = Object.entries(rewrites)
    .reduce((rewrites, [source, destination]) => (
      (rewrites || []).concat({ source, destination })
    ), baseUrl ? [{
      source: path.posix.join(baseUrl, '/:path*'),
      destination: '/:path*'
    }] : undefined);

  // start the server
  let server = !dry && await new Promise(resolve => {
    let server = require('http').createServer((req, res) => {
      require('serve-handler')(req, res, { public: dir, cleanUrls, rewrites });
    }).listen(() => resolve(server));
  });

  // easy clean up
  let close = () => {
    if (server) {
      return new Promise(resolve => {
        server.close(resolve);
      });
    }
  };

  // add the port to the host and return
  if (server) host += `:${server.address().port}`;
  return { host, rewrites, server, close };
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
        } catch (e) {}
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

// Maps an array of snapshots or paths to options ready to pass along to the core snapshot
// method. Paths are normalized before overrides are conditionally applied via their own include and
// exclude options. Snapshot URLs are then rewritten accordingly before default options are applied,
// including prepending the appropriate host. The returned set of snapshot options are sorted and
// filtered by the top-level include and exclude options.
export function mapStaticSnapshots(snapshots, {
  host,
  include,
  exclude,
  cleanUrls,
  rewrites = [],
  overrides = []
} = {}) {
  // reduce rewrites into a single function
  let applyRewrites = [{
    test: url => !/^(https?:\/)?\//.test(url) && url,
    rewrite: url => path.posix.normalize(path.posix.join('/', url))
  }, ...rewrites.map(({ source, destination }) => ({
    test: pathToRegexp.match(destination),
    rewrite: pathToRegexp.compile(source)
  })), {
    test: url => cleanUrls && url,
    rewrite: url => url.replace(/(\/index)?\.html$/, '')
  }].reduceRight((apply, { test, rewrite }) => snap => {
    let res = test(snap.url ?? snap);
    if (res) snap = rewrite(res.params ?? res);
    return apply(snap);
  }, s => s);

  // reduce overrides into a single function
  let applyOverrides = overrides
    .reduceRight((apply, { include, exclude, ...opts }) => snap => {
      if (snapshotMatches(snap, include, exclude)) Object.assign(snap, opts);
      return apply(snap);
    }, s => s);

  // sort and reduce snapshots with overrides
  return [...snapshots].sort().reduce((snapshots, snap) => {
    snap = withDefaults(applyRewrites(snap), { host });

    return snapshotMatches(snap, include, exclude)
      ? snapshots.concat(applyOverrides(snap)) : snapshots;
  }, []);
}
