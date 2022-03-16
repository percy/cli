import { request, sha256hash, hostnameMatches } from '@percy/client/utils';
export { request, hostnameMatches };

// Returns the hostname portion of a URL.
export function hostname(url) {
  return new URL(url).hostname;
}

// Normalizes a URL by stripping hashes to ensure unique resources.
export function normalizeURL(url) {
  let { protocol, host, pathname, search } = new URL(url);
  return `${protocol}//${host}${pathname}${search}`;
}

// Creates a local resource object containing the resource URL, mimetype, content, sha, and any
// other additional resources attributes.
export function createResource(url, content, mimetype, attrs) {
  return { ...attrs, sha: sha256hash(content), mimetype, content, url };
}

// Creates a root resource object with an additional `root: true` property. The URL is normalized
// here as a convenience since root resources are usually created outside of asset discovery.
export function createRootResource(url, content) {
  return createResource(normalizeURL(url), content, 'text/html', { root: true });
}

// Creates a Percy CSS resource object.
export function createPercyCSSResource(url, css) {
  let { href, pathname } = new URL(`/percy-specific.${Date.now()}.css`, url);
  return createResource(href, css, 'text/css', { pathname });
}

// Creates a log resource object.
export function createLogResource(logs) {
  return createResource(`/percy.${Date.now()}.log`, JSON.stringify(logs), 'text/plain');
}

// Creates a thennable, cancelable, generator instance
export function generatePromise(gen) {
  // ensure a generator is provided
  if (typeof gen === 'function') gen = gen();
  if (typeof gen?.then === 'function') return gen;
  if (typeof gen?.next !== 'function' || !(
    typeof gen[Symbol.iterator] === 'function' ||
    typeof gen[Symbol.asyncIterator] === 'function'
  )) return Promise.resolve(gen);

  // used to trigger cancelation
  class Canceled extends Error {
    name = 'Canceled';
    canceled = true;
  }

  // recursively runs the generator, maybe throwing an error when canceled
  let handleNext = async (g, last) => {
    let canceled = g.cancel.triggered;

    let { done, value } = canceled
      ? await g.throw(canceled)
      : await g.next(last);

    if (canceled) delete g.cancel.triggered;
    return done ? value : handleNext(g, value);
  };

  // handle cancelation errors by calling any cancel handlers
  let cancelable = (async function*() {
    try { return yield* gen; } catch (error) {
      if (error.canceled) {
        let cancelers = cancelable.cancelers || [];
        for (let c of cancelers) await c(error);
      }

      throw error;
    }
  })();

  // augment the cancelable generator with promise-like and cancel methods
  return Object.assign(cancelable, {
    run: () => (cancelable.promise ||= handleNext(cancelable)),
    then: (resolve, reject) => cancelable.run().then(resolve, reject),
    catch: reject => cancelable.run().catch(reject),
    cancel: message => {
      cancelable.cancel.triggered = new Canceled(message);
      return cancelable;
    },
    canceled: handler => {
      (cancelable.cancelers ||= []).push(handler);
      return cancelable;
    }
  });
}

// Resolves when the predicate function returns true within the timeout. If an idle option is
// provided, the predicate will be checked again before resolving, after the idle period. The poll
// option determines how often the predicate check will be run.
export function waitFor(predicate, options) {
  let { poll = 10, timeout, idle } = Number.isInteger(options)
    ? { timeout: options } : (options || {});

  return generatePromise(async function* check(start, done) {
    while (true) {
      if (timeout && Date.now() - start >= timeout) {
        throw new Error(`Timeout of ${timeout}ms exceeded.`);
      } else if (!predicate()) {
        yield new Promise(r => setTimeout(r, poll, (done = false)));
      } else if (idle && !done) {
        yield new Promise(r => setTimeout(r, idle, (done = true)));
      } else {
        return;
      }
    }
  }(Date.now()));
}
