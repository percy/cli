import EventEmitter from 'events';
import { sha256hash } from '@percy/client/utils';

export {
  request,
  getPackageJSON,
  hostnameMatches
} from '@percy/client/utils';

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

// Iterates over the provided generator and resolves to the final value when done. With an
// AbortSignal, the generator will throw with the abort reason when aborted. Also accepts an
// optional node-style callback, called before the returned promise resolves.
export async function generatePromise(gen, signal, cb) {
  try {
    if (typeof signal === 'function') [cb, signal] = [signal];
    if (typeof gen === 'function') gen = await gen();

    let { done, value } = (typeof gen?.next === 'function' && (
      typeof gen[Symbol.iterator] === 'function' ||
      typeof gen[Symbol.asyncIterator] === 'function'
    )) ? await gen.next() : { done: true, value: await gen };

    while (!done) {
      ({ done, value } = signal?.aborted
        ? await gen.throw(signal.reason)
        : await gen.next(value));
    }

    if (!cb) return value;
    return cb(null, value);
  } catch (error) {
    if (!cb) throw error;
    return cb(error);
  }
}

// Bare minimum AbortController polyfill for Node < 16.14
export class AbortController {
  signal = new EventEmitter();
  abort(reason = new AbortError()) {
    if (this.signal.aborted) return;
    Object.assign(this.signal, { reason, aborted: true });
    this.signal.emit('abort', reason);
  }
}

// Similar to DOMException[AbortError] but accepts additional properties
export class AbortError extends Error {
  constructor(msg = 'This operation was aborted', props) {
    Object.assign(super(msg), { name: 'AbortError', ...props });
  }
}

// An async generator that infinitely yields to the predicate function until a truthy value is
// returned. When a timeout is provided, an error will be thrown during the next iteration after the
// timeout has been exceeded. If an idle option is provided, the predicate will be yielded to a
// second time, after the idle period, to ensure the yielded value is still truthy. The poll option
// determines how long to wait before yielding to the predicate function during each iteration.
export async function* yieldFor(predicate, options = {}) {
  if (Number.isInteger(options)) options = { timeout: options };
  let { timeout, idle, poll = 10 } = options;
  let start = Date.now();
  let done, value;

  while (true) {
    if (timeout && Date.now() - start >= timeout) {
      throw new Error(`Timeout of ${timeout}ms exceeded.`);
    } else if (!(value = yield predicate())) {
      done = await waitForTimeout(poll, false);
    } else if (idle && !done) {
      done = await waitForTimeout(idle, true);
    } else {
      return value;
    }
  }
}

// Promisified version of `yieldFor` above.
export function waitFor() {
  return generatePromise(yieldFor(...arguments));
}

// Promisified version of `setTimeout` (no callback argument).
export function waitForTimeout() {
  return new Promise(resolve => setTimeout(resolve, ...arguments));
}
