import picomatch from 'picomatch';

// used to deserialize regular expression strings
const RE_REGEXP = /^\/(.+)\/(\w+)?$/;

// Throw a better error message for invalid urls
function validURL(url, base) {
  try { return new URL(url, base); } catch (e) {
    throw new Error(`Invalid URL: ${e.input}`);
  }
}

// Returns true or false if a snapshot matches the provided include and exclude predicates. A
// predicate can be an array of predicates, a regular expression, a glob pattern, or a function.
function snapshotMatches(snapshot, include, exclude) {
  // support an options object as the second argument
  if (arguments.length === 2 && (include.include || include.exclude)) {
    ({ include, exclude } = include);
  }

  // recursive predicate test function
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

  // nothing to match, return true
  if (!include && !exclude) return true;
  // not excluded or explicitly included
  return !test(exclude, false) && test(include, true);
}

// Maps an array of snapshots to an object ready to pass along to the core snapshot method. Paths
// are normalized before overrides are conditionally applied via their own include and exclude
// options. Snapshot URLs are normalized to include the base URL before matching override options
// are applied. The returned set of snapshot options are sorted and filtered by the top-level
// include and exclude options.
function mapSnapshots(snapshots, options) {
  // reduce overrides into a single function
  let applyOverrides = (options?.overrides || [])
    .reduceRight((next, override) => snapshot => {
      // assign overrides when matching include/exclude
      if (snapshotMatches(snapshot, override)) {
        let { include, exclude, ...opts } = override;
        Object.assign(snapshot, opts);
      }

      // call the next override function
      return next ? next(snapshot) : snapshot;
    }, null);

  // sort and reduce snapshots with overrides
  return [...snapshots].sort().reduce((acc, snapshot) => {
    // transform snapshot URL shorthand into an object
    if (typeof snapshot === 'string') snapshot = { url: snapshot };

    // normalize the snapshot url and use it for the default name
    let url = validURL(snapshot.url, options?.baseUrl);
    snapshot.name ||= `${url.pathname}${url.search}${url.hash}`;
    snapshot.url = url.href;

    // use the snapshot when matching include/exclude
    if (snapshotMatches(snapshot, options)) {
      acc.push(applyOverrides(snapshot));
    }

    return acc;
  }, []);
}

function createRewriter(options) {
  let { baseUrl, cleanUrls, rewrites } = options ?? {};
  let rules = Object.entries(rewrites ?? {});

  // add base url rewrite rule
  if (baseUrl) {
    let basePath = path.posix.join(baseUrl, '/:path*');
    rules.unshift([basePath, '/:path*']);
  }

  // normalize rewrite rules
  let normalize = p => path.posix.normalize(path.posix.join('/', p));
  let resolver = { match: p => p, apply: p => path.posix.resolve(normalize(p)) };
  rules = rules.map(rule => rule.map(normalize));

  // compile destination rewrite rules
  let destRules = [resolver].concat(rules.map(([src, dest]) => {
    let match = pathToRegexp.match(src);
    let toPath = pathToRegexp.compile(dest);
    return { match, apply: r => toPath(r.params) };
  }));

  // compile source rewrite rules
  let srcRules = [resolver].concat(rules.reverse().map(([src, dest]) => {
    let match = pathToRegexp.match(dest);
    let toPath = pathToRegexp.compile(src);
    return { match, apply: r => toPath(r.params) };
  }), {
    match: p => cleanUrls && p,
    apply: p => p.replace(/(\/index)?\.html$/, '')
  });

  // reducer to rewrite a pathname according to a rule
  let rewriter = (next, rule) => pathname => {
    let result = rule.match(pathname);
    if (result) pathname = rule.apply(result);
    return next ? next(pathname) : pathname;
  };

  return {
    toSource: srcRules.reduceRight(rewriter, null),
    toDestination: destRules.reduceRight(rewriter, null),
    cleanUrls: !!cleanUrls
  };
}

export function createStaticServer(dir, options) {
  let root = path.resolve(process.cwd(), dir);
  let rewrite = createRewriter(options);
  let log = logger('core:static');

  // strip root of possible ending path
  if (root.endsWith(path.sep)) root = root.slice(0, -1);

  // small error helper to create a status error
  let error = (status = 500) => Object.assign(new Error(), {
    status, message: http.STATUS_CODES[status]
  });

  // get the requested path
  let getPath = request => {
    try {
      let { pathname } = new URL(request.url, context.address);
      pathname = decodeURIComponent(pathname);

      // protect against root access
      let abs = path.join(root, pathname);
      if (abs.endsWith(path.sep)) abs = abs.slice(0, -1);
      if (abs.lastIndexOf(root, 0)) throw error();
      if (abs[root.length] && abs[root.length] !== path.sep) throw error();

      return pathname;
    } catch (err) {
      log.debug(err);
      throw error(400);
    }
  };

  // get the absolute path and stats of a file
  let getFile = async pathname => {
    try {
      let abs = path.resolve(path.join(root, pathname));
      return { path: abs, stats: await fs.promises.lstat(abs) };
    } catch (err) {
      if (err.code !== 'ENOENT' && err.code !== 'ENOTDIR') throw err;
    }
  };

  // get sitemap entries
  let getSitemap = async () => {
    let filenames = await glob('**/*.html', { cwd: root });
    return filenames.map(rewrite.toSource);
  };

  // get sitemap xml content
  let getSitemapXML = () => getSitemap().then(urls => [
    '<?xml version="1.0" encoding="UTF-8"?>'
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls.map(loc => `  <url><loc>${loc}</loc></url>`),
    '</urlset>'
  ].join('\n'));

  // static server context
  let context = createServer({
    default: async request => {
      let pathname = rewrite.toDestination(getPath(request));
      let file = await getFile(pathname);

      // with clean urls, look for other possible files
      if (rewrite.cleanUrls && !file?.stats.isFile()) {
        let possible = [
          path.join(pathname, 'index.html'),
          pathname.length > 2 && pathname.replace(/\/?$/, '.html')
        ].filter(Boolean);

        for (let maybe of possible) {
          file = await getFile(maybe);
          if (file) break;
        }
      }

      // file not found, support automatic sitemaps
      if (!file?.stats.isFile()) {
        if (pathname === '/sitemap.json') {
          return [200, 'application/json', await getSitemap()];
        } else if (pathname === '/sitemap.xml') {
          return [200, 'application/xml', await getSitemapXML()];
        } else {
          throw error(404);
        }
      }

      return [200, file.path];
    },

    // support status pages
    catch: (err, request) => {
      let status = err.status ?? 500;
      let page = path.join(root, `${status}.html`);
      log.debug(err.status ? `${err.message} - ${request.url}` : err);
      if (fs.existsSync(page)) return [status, page];
      return [status, 'text/plain', error.message];
    }
  });

  context.getSitemap = getSitemap;
  context.rewrite = rewrite;
  return context;
}

export default createStaticServer;
