import path from 'path';
import { createServer } from 'http';
import serveHandler from 'serve-handler';
import * as pathToRegexp from 'path-to-regexp';

import {
  validURL,
  withDefaults,
  snapshotMatches
} from './utils';

// Transforms a source-destination map into an array of source-destination objects
function mapRewrites(map, arr) {
  return Object.entries(map).reduce((r, [source, destination]) => {
    return (r || []).concat({ source, destination });
  }, arr);
}

// Serves a static directory with the provided options and returns an object containing adjusted
// rewrites (combined with any baseUrl), the server host, a close method, and the server
// instance. The `dryRun` option will prevent the server from actually starting.
export async function serve(dir, {
  dryRun,
  baseUrl,
  cleanUrls,
  rewrites = {}
}) {
  let host = 'http://localhost';
  let connections = new Set();

  // coerce any provided base-url into a base-url path
  if (baseUrl && !baseUrl.startsWith('/')) {
    baseUrl = validURL(baseUrl).path;
  }

  // map rewrite options with the base-url
  rewrites = mapRewrites(rewrites, baseUrl && [{
    source: path.posix.join(baseUrl, '/:path*'),
    destination: '/:path*'
  }]);

  // start the server
  let server = !dryRun && await new Promise(resolve => {
    let server = createServer((req, res) => serveHandler(
      req, res, { public: dir, cleanUrls, rewrites }
    )).listen(() => resolve(server)).on('connection', s => {
      connections.add(s.on('close', () => connections.delete(s)));
    });
  });

  // easy clean up
  let close = () => server && new Promise(resolve => {
    /* istanbul ignore next: sometimes needed when connections are hanging */
    connections.forEach(s => s.destroy());
    server.close(resolve);
  });

  // add the port to the host and return
  if (server) host += `:${server.address().port}`;
  return { host, rewrites, server, close };
}

// Maps an array of snapshots or paths to options ready to pass along to the core snapshot
// method. Paths are normalized before overrides are conditionally applied via their own include and
// exclude options. Snapshot URLs are then rewritten accordingly before default options are applied,
// including prepending the appropriate host. The returned set of snapshot options are sorted and
// filtered by the top-level include and exclude options.
export function mapStaticSnapshots(snapshots, /* istanbul ignore next: safe defaults */ {
  host,
  include,
  exclude,
  cleanUrls,
  rewrites = [],
  overrides = [],
  server
} = {}) {
  // prioritize server properties
  host = server?.host ?? host;
  rewrites = server?.rewrites ?? mapRewrites(rewrites, []);

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

// Serves a static directory and returns a list of snapshots.
export async function loadStaticSnapshots(dir, config) {
  let { default: globby } = await import('globby');

  // gather paths with globby, which only accepts string patterns
  let isStr = s => typeof s === 'string';
  let strOr = (a, b) => a.length && a.every(isStr) ? a : b;
  let files = strOr([].concat(config.include || []), '**/*.html');
  let ignore = strOr([].concat(config.exclude || []), []);
  let paths = await globby(files, { cwd: dir, ignore });

  // map snapshots from paths and config
  return mapStaticSnapshots(paths, config);
}
