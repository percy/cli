import EventEmitter from 'events';
import { sha256hash } from '@percy/client/utils';
import { camelcase, merge } from '@percy/config/utils';

export {
  request,
  getPackageJSON,
  hostnameMatches
} from '@percy/client/utils';

export {
  Server,
  createServer
} from './server.js';

// Returns the hostname portion of a URL.
export function hostname(url) {
  return new URL(url).hostname;
}

// Normalizes a URL by stripping hashes to ensure unique resources.
export function normalizeURL(url) {
  let { protocol, host, pathname, search } = new URL(url);
  return `${protocol}//${host}${pathname}${search}`;
}

/* istanbul ignore next: tested, but coverage is stripped */
// Returns the body for automateScreenshot in structure
export function percyAutomateRequestHandler(req, percy) {
  if (req.body.client_info) {
    req.body.clientInfo = req.body.client_info;
  }
  if (req.body.environment_info) {
    req.body.environmentInfo = req.body.environment_info;
  }

  // combines array and overrides global config with per-screenshot config
  let camelCasedOptions = {};
  Object.entries(req.body.options || {}).forEach(([key, value]) => {
    camelCasedOptions[camelcase(key)] = value;
  });

  req.body.options = merge([{
    percyCSS: percy.config.snapshot.percyCSS,
    freezeAnimation: percy.config.snapshot.freezeAnimation,
    ignoreRegionSelectors: percy.config.snapshot.ignoreRegions?.ignoreRegionSelectors,
    ignoreRegionXpaths: percy.config.snapshot.ignoreRegions?.ignoreRegionXpaths,
    considerRegionSelectors: percy.config.snapshot.considerRegions?.considerRegionSelectors,
    considerRegionXpaths: percy.config.snapshot.considerRegions?.considerRegionXpaths
  },
  camelCasedOptions
  ], (path, prev, next) => {
    switch (path.map(k => k.toString()).join('.')) {
      case 'percyCSS': // concatenate percy css
        return [path, [prev, next].filter(Boolean).join('\n')];
    }
  });
  req.body.buildInfo = percy.build;
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
  let [url, content] = [`/percy.${Date.now()}.log`, JSON.stringify(logs)];
  return createResource(url, content, 'text/plain', { log: true });
}

// Returns true or false if the provided object is a generator or not
export function isGenerator(subject) {
  return typeof subject?.next === 'function' && (
    typeof subject[Symbol.iterator] === 'function' ||
    typeof subject[Symbol.asyncIterator] === 'function'
  );
}

// Iterates over the provided generator and resolves to the final value when done. With an
// AbortSignal, the generator will throw with the abort reason when aborted. Also accepts an
// optional node-style callback, called before the returned promise resolves.
export async function generatePromise(gen, signal, cb) {
  try {
    if (typeof signal === 'function') [cb, signal] = [signal];
    if (typeof gen === 'function') gen = await gen();

    let { done, value } = !isGenerator(gen)
      ? { done: true, value: await gen }
      : await gen.next();

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

// An async generator that yields after every event loop until the promise settles
export async function* yieldTo(subject) {
  // yield to any provided generator or return non-promise values
  if (isGenerator(subject)) return yield* subject;
  if (typeof subject?.then !== 'function') return subject;

  // update local variables with the provided promise
  let result, error, pending = !!subject
    .then(r => (result = r), e => (error = e))
    .finally(() => (pending = false));

  /* eslint-disable-next-line no-unmodified-loop-condition */
  while (pending) yield new Promise(r => setImmediate(r));
  if (error) throw error;
  return result;
}

// An async generator that runs provided generators concurrently
export async function* yieldAll(all) {
  let res = new Array(all.length).fill();
  all = all.map(yieldTo);

  while (true) {
    res = await Promise.all(all.map((g, i) => (
      res[i]?.done ? res[i] : g.next(res[i]?.value)
    )));

    let vals = res.map(r => r?.value);
    if (res.some(r => !r?.done)) yield vals;
    else return vals;
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

// Browser-specific util to wait for a query selector to exist within an optional timeout.
/* istanbul ignore next: tested, but coverage is stripped */
async function waitForSelector(selector, timeout) {
  try {
    return await waitFor(() => document.querySelector(selector), timeout);
  } catch {
    throw new Error(`Unable to find: ${selector}`);
  }
}

// Browser-specific util to wait for an xpath selector to exist within an optional timeout.
/* istanbul ignore next: tested, but coverage is stripped */
async function waitForXPath(selector, timeout) {
  try {
    let xpath = () => document.evaluate(selector, document, null, 9, null);
    return await waitFor(() => xpath().singleNodeValue, timeout);
  } catch {
    throw new Error(`Unable to find: ${selector}`);
  }
}

// Browser-specific util to scroll to the bottom of a page, optionally calling the provided function
// after each window segment has been scrolled.
/* istanbul ignore next: tested, but coverage is stripped */
async function scrollToBottom(options, onScroll) {
  if (typeof options === 'function') [onScroll, options] = [options];
  let size = () => Math.ceil(document.body.scrollHeight / window.innerHeight);

  for (let s, i = 1; i < (s = size()); i++) {
    window.scrollTo({ ...options, top: window.innerHeight * i });
    await onScroll?.(i, s);
  }
}

// Used to test if a string looks like a function
const FUNC_REG = /^(async\s+)?(function\s*)?(\w+\s*)?\(.*?\)\s*(\{|=>)/is;

// Serializes the provided function with percy helpers for use in evaluating browser scripts
export function serializeFunction(fn) {
  // stringify or convert a function body into a complete function
  let fnbody = (typeof fn === 'string' && !FUNC_REG.test(fn))
    ? `async function eval() {\n${fn}\n}` : fn.toString();

  // we might have a function shorthand if this fails
  /* eslint-disable-next-line no-new, no-new-func */
  try { new Function(`(${fnbody})`); } catch (error) {
    fnbody = fnbody.startsWith('async ')
      ? fnbody.replace(/^async/, 'async function')
      : `function ${fnbody}`;

    /* eslint-disable-next-line no-new, no-new-func */
    try { new Function(`(${fnbody})`); } catch (error) {
      throw new Error('The provided function is not serializable');
    }
  }

  // wrap the function body with percy helpers
  fnbody = 'function withPercyHelpers() {\n' + [
    'const { config, snapshot } = window.__PERCY__ ?? {};',
    `return (${fnbody})({`,
    '  config, snapshot, generatePromise, yieldFor,',
    '  waitFor, waitForTimeout, waitForSelector, waitForXPath,',
    '  scrollToBottom',
    '}, ...arguments);',
    `${isGenerator}`,
    `${generatePromise}`,
    `${yieldFor}`,
    `${waitFor}`,
    `${waitForTimeout}`,
    `${waitForSelector}`,
    `${waitForXPath}`,
    `${scrollToBottom}`
  ].join('\n') + '\n}';

  /* istanbul ignore else: ironic. */
  if (fnbody.includes('cov_')) {
    // remove coverage statements during testing
    fnbody = fnbody.replace(/cov_.*?(;\n?|,)\s*/g, '');
  }

  return fnbody;
}
