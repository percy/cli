import { sha256hash, hostnameMatches } from '@percy/client/dist/utils';
export { hostnameMatches };

// Returns the hostname portion of a URL.
export function hostname(url) {
  return new URL(url).hostname;
}

// Normalizes a URL by stripping hashes to ensure unique resources.
export function normalizeURL(url) {
  let { protocol, host, pathname, search } = new URL(url);
  return `${protocol}//${host}${pathname}${search}`;
}

// Creates a local resource object containing the resource URL, SHA, mimetype,
// and local filepath in the OS temp directory. If the file does not exist, it
// is created unless it exceeds the file size limit.
export function createResource(url, content, mimetype, attrs) {
  return { ...attrs, sha: sha256hash(content), mimetype, content, url };
}

// Creates a root resource object containing the URL, SHA, content, and mimetype with an
// additional `root: true` property. The URL is normalized here as a convenience since root
// resources are usually created outside of asset discovery.
export function createRootResource(url, content) {
  return createResource(normalizeURL(url), content, 'text/html', { root: true });
}

// Creates a log resource object.
export function createLogResource(logs) {
  return createResource(`/percy.${Date.now()}.log`, JSON.stringify(logs), 'text/plain');
}

// Creates a Percy CSS resource object.
export function createPercyCSSResource(css) {
  return createResource(`/percy-specific.${Date.now()}.css`, css, 'text/css');
}

// returns a new root resource with the injected Percy CSS
export function injectPercyCSS(root, percyCSS) {
  return percyCSS ? createRootResource(root.url, root.content.replace(/(<\/body>)(?!.*\1)/is, (
    `<link data-percy-specific-css rel="stylesheet" href="${percyCSS.url}"/>`
  ) + '$&')) : root;
}

// Polls for the predicate to be truthy within a timeout or the returned promise rejects. If
// the second argument is an options object and `ensure` is provided, the predicate will be
// checked again after the ensure period. This helper is injected as an argument when using
// the `page#eval()` method, such as for the snapshot `execute` option.
/* istanbul ignore next: no instrumenting injected code */
export function waitFor(predicate, timeoutOrOptions) {
  let { poll = 10, timeout, idle } =
    Number.isInteger(timeoutOrOptions)
      ? { timeout: timeoutOrOptions }
      : (timeoutOrOptions || {});

  return new Promise((resolve, reject) => {
    return (function check(start, done) {
      try {
        if (timeout && Date.now() - start >= timeout) {
          throw new Error(`Timeout of ${timeout}ms exceeded.`);
        } else if (predicate()) {
          if (idle && !done) {
            setTimeout(check, idle, start, true);
          } else {
            resolve();
          }
        } else {
          setTimeout(check, poll, start);
        }
      } catch (error) {
        reject(error);
      }
    })(Date.now());
  });
}
