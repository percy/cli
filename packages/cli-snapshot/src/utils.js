import path from 'path';
import * as pathToRegexp from 'path-to-regexp';
import picomatch from 'picomatch';

// Throw a better error message for invalid urls
function validURL(url, base) {
  try { return new URL(url, base); } catch (e) {
    throw new Error(`Invalid URL: ${e.input}`);
  }
}

// Mutates a page item to have default or normalized options
export function withDefaults(page, { host }) {
  // allow URL strings as pages
  if (typeof page === 'string') page = { url: page };

  // validate URL
  let url = validURL(page.url, host);

  // default name to the page url
  page.name ||= `${url.pathname}${url.search}${url.hash}`;
  // normalize the page url
  page.url = url.href;

  return page;
}

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

export function mapPages(paths, {
  host,
  cleanUrls,
  rewrites = [],
  overrides = []
}) {
  // map, concat, and reduce rewrites with overrides into a single function
  let applyOverrides = [].concat({
    rewrite: url => path.posix.normalize(path.posix.join('/', url))
  }, rewrites.map(({ source, destination }) => ({
    test: pathToRegexp.match(destination),
    rewrite: pathToRegexp.compile(source)
  })), {
    test: url => cleanUrls && url,
    rewrite: url => url.replace(/(\/index)?\.html$/, '')
  }, overrides.map(({ files, ignore, ...opts }) => ({
    test: picomatch(files || '**', { ignore: [].concat(ignore || []) }),
    override: page => Object.assign(page, opts)
  })), {
    override: page => withDefaults(page, { host })
  }).reduceRight((apply, { test, rewrite, override }) => {
    return (p, page = { url: p }) => {
      let res = !test || test(rewrite ? page.url : p);
      if (res && rewrite) page.url = rewrite(test ? (res.params ?? res) : page.url);
      else if (res && override) override(page);
      return apply?.(p, page) ?? page;
    };
  }, null);

  // sort and map pages with overrides
  return paths.sort().map(p => {
    return applyOverrides(p);
  });
}
