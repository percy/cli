import { promises as fs } from 'fs';
import EventEmitter from 'events';
import logger from '@percy/logger';
import Network from './network';
import { hostname, waitFor } from './utils';

// Used by some methods to impose a strict maximum timeout, such as .goto and .snapshot
const PAGE_TIMEOUT = 30000;

export default class Page extends EventEmitter {
  #browser = null;
  #sessionId = null;
  #targetId = null;
  #frameId = null;
  #contextId = null;

  #callbacks = new Map();
  #lifecycle = new Set();

  closedReason = null;
  log = logger('core:page');

  constructor(browser, { params, sessionId: parentId }) {
    super();

    this.#browser = browser;
    this.#sessionId = params.sessionId;
    this.#targetId = params.targetInfo.targetId;

    this.network = new Network(this);

    this.on('Page.lifecycleEvent', this._handleLifecycleEvent);
    this.on('Runtime.executionContextCreated', this._handleExecutionContextCreated);
    this.on('Runtime.executionContextDestroyed', this._handleExecutionContextDestroyed);
    this.on('Runtime.executionContextsCleared', this._handleExecutionContextsCleared);
    this.on('Inspector.targetCrashed', this._handleTargetCrashed);

    // if there is a parent session, automatically init this session
    this.parent = browser.pages.get(parentId);
    if (this.parent) this.init(this.parent.options);
  }

  // initial page options asynchronously
  async init(options = {}) {
    this.options = options;

    let {
      cacheDisabled = true,
      enableJavaScript = true,
      requestHeaders = {},
      networkIdleTimeout,
      authorization,
      userAgent,
      intercept,
      meta
    } = options;

    this.log.debug('Initialize page', meta);
    this.network.timeout = networkIdleTimeout;
    this.network.authorization = authorization;
    this.meta = meta;

    let [, { frameTree }, version] = await Promise.all([
      this.send('Page.enable'),
      this.send('Page.getFrameTree'),
      this.send('Browser.getVersion')
    ]);

    this.#frameId = frameTree.frame.id;
    // by default, emulate a non-headless browser
    userAgent ||= version.userAgent.replace('Headless', '');

    // auto-attach related targets
    let autoAttachTarget = {
      waitForDebuggerOnStart: false,
      autoAttach: true,
      flatten: true
    };

    await Promise.all([
      this.send('Runtime.enable'),
      this.send('Target.setAutoAttach', autoAttachTarget),
      this.send('Page.setLifecycleEventsEnabled', { enabled: true }),
      this.send('Network.setCacheDisabled', { cacheDisabled }),
      this.send('Network.setExtraHTTPHeaders', { headers: requestHeaders }),
      this.send('Network.setUserAgentOverride', { userAgent }),
      this.send('Security.setIgnoreCertificateErrors', { ignore: true }),
      this.send('Emulation.setScriptExecutionDisabled', { value: !enableJavaScript })
    ]);

    if (intercept) {
      await this.network.intercept(intercept);
    }

    return this;
  }

  // Close the target page if not already closed
  async close() {
    if (!this.#browser) return;

    /* istanbul ignore next: errors race here when the browser closes */
    await this.#browser.send('Target.closeTarget', { targetId: this.#targetId })
      .catch(error => this.log.debug(error, this.meta));
  }

  async resize({
    deviceScaleFactor = 1,
    mobile = false,
    height = 1024,
    width = 1280
  }) {
    this.log.debug(`Resize page to ${width}x${height}`);

    await this.send('Emulation.setDeviceMetricsOverride', {
      deviceScaleFactor,
      mobile,
      height,
      width
    });
  }

  // Go to a URL and wait for navigation to occur
  async goto(url, { waitUntil = 'load' } = {}) {
    let handleNavigate = event => {
      /* istanbul ignore else: sanity check */
      if (this.#frameId === event.frame.id) handleNavigate.done = true;
    };

    // set cookies before navigation so we can default the domain to this hostname
    if (this.#browser.cookies.length) {
      let defaultDomain = hostname(url);

      await this.send('Network.setCookies', {
        // spread is used to make a shallow copy of the cookie
        cookies: this.#browser.cookies.map(({ ...cookie }) => {
          if (!cookie.url) cookie.domain ||= defaultDomain;
          return cookie;
        })
      });
    }

    try {
      this.once('Page.frameNavigated', handleNavigate);
      this.log.debug(`Navigate to: ${url}`, this.meta);

      // trigger navigation and handle error responses
      let navigate = this.send('Page.navigate', { url })
        .then(({ errorText }) => {
          if (errorText) throw new Error(errorText);
        });

      // wait until navigation was handled and the correct lifecycle happened
      await Promise.all([navigate, waitFor(() => {
        if (this.closedReason) throw new Error(this.closedReason);
        return handleNavigate.done && this.#lifecycle.has(waitUntil);
      }, PAGE_TIMEOUT)]);
    } catch (error) {
      this.off('Page.frameNavigated', handleNavigate);

      throw Object.assign(error, {
        message: `Navigation failed: ${error.message}`
      });
    }

    this.log.debug('Page navigated', this.meta);
  }

  // Evaluate JS functions within the page's execution context
  async eval(fn, ...args) {
    let fnbody = fn.toString();

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
    fnbody = 'function withPercyHelpers() {' + (
      `return (${fnbody})({` + (
        `waitFor: ${waitFor}`
      ) + '}, ...arguments)'
    ) + '}';

    // send the call function command
    let { result, exceptionDetails } = await this.send('Runtime.callFunctionOn', {
      functionDeclaration: fnbody,
      arguments: args.map(value => ({ value })),
      executionContextId: this.#contextId,
      returnByValue: true,
      awaitPromise: true,
      userGesture: true
    });

    if (exceptionDetails) {
      throw exceptionDetails.exception.description;
    } else {
      return result.value;
    }
  }

  async snapshot({
    name,
    waitForTimeout,
    waitForSelector,
    execute,
    ...options
  }) {
    // wait for any specified timeout
    if (waitForTimeout) {
      this.log.debug(`Wait for ${waitForTimeout}ms timeout`, this.meta);
      await new Promise(resolve => setTimeout(resolve, waitForTimeout));
    }

    // wait for any specified selector
    if (waitForSelector) {
      this.log.debug(`Wait for selector: ${waitForSelector}`, this.meta);

      /* istanbul ignore next: no instrumenting injected code */
      await this.eval(function waitForSelector({ waitFor }, selector, timeout) {
        return waitFor(() => !!document.querySelector(selector), timeout)
          .catch(() => Promise.reject(new Error(`Failed to find "${selector}"`)));
      }, waitForSelector, PAGE_TIMEOUT);
    }

    // execute any javascript
    if (execute) {
      this.log.debug('Execute JavaScript', { ...this.meta, execute });
      // accept function bodies as strings
      if (typeof execute === 'string') execute = `async execute({ waitFor }) {\n${execute}\n}`;
      // execute the provided function
      await this.eval(execute);
    }

    // wait for any final network activity before capturing the dom snapshot
    await this.network.idle();

    // inject @percy/dom for serialization by evaluating the file contents which adds a global
    // PercyDOM object that we can later check against
    /* istanbul ignore next: no instrumenting injected code */
    if (await this.eval(() => !window.PercyDOM)) {
      this.log.debug('Inject @percy/dom', this.meta);
      let script = await fs.readFile(require.resolve('@percy/dom'), 'utf-8');
      await this.eval(new Function(script)); /* eslint-disable-line no-new-func */
    }

    // serialize and capture a DOM snapshot
    this.log.debug('Serialize DOM', this.meta);

    /* istanbul ignore next: no instrumenting injected code */
    return await this.eval((_, options) => ({
      /* eslint-disable-next-line no-undef */
      dom: PercyDOM.serialize(options),
      url: document.URL
    }), options);
  }

  async send(method, params) {
    let error = new Error();

    /* istanbul ignore next: race condition paranoia */
    if (this.closedReason) {
      return Promise.reject(Object.assign(error, {
        message: `Protocol error (${method}): ${this.closedReason}`
      }));
    }

    // send a raw message to the browser so we can provide a sessionId
    let id = await this.#browser.send({ sessionId: this.#sessionId, method, params });

    // return a promise that will resolve or reject when a response is received
    return new Promise((resolve, reject) => {
      this.#callbacks.set(id, { error, resolve, reject, method });
    });
  }

  _handleMessage(data) {
    if (data.id && this.#callbacks.has(data.id)) {
      // resolve or reject a pending promise created with #send()
      let callback = this.#callbacks.get(data.id);
      this.#callbacks.delete(data.id);

      /* istanbul ignore next: races with browser._handleMessage() */
      if (data.error) {
        callback.reject(Object.assign(callback.error, {
          message: `Protocol error (${callback.method}): ${data.error.message}` +
            ('data' in data.error ? `: ${data.error.data}` : '')
        }));
      } else {
        callback.resolve(data.result);
      }
    } else {
      // emit the message as an event
      this.emit(data.method, data.params);
    }
  }

  _handleClose() {
    this.log.debug('Page closing', this.meta);
    this.closedReason ||= 'Page closed.';

    // reject any pending callbacks
    for (let callback of this.#callbacks.values()) {
      callback.reject(Object.assign(callback.error, {
        message: `Protocol error (${callback.method}): ${this.closedReason}`
      }));
    }

    this.#callbacks.clear();
    this.#browser = null;
  }

  _handleLifecycleEvent = event => {
    if (this.#frameId === event.frameId) {
      if (event.name === 'init') this.#lifecycle.clear();
      this.#lifecycle.add(event.name);
    }
  }

  _handleExecutionContextCreated = event => {
    if (this.#frameId === event.context.auxData.frameId) {
      this.#contextId = event.context.id;
    }
  }

  _handleExecutionContextDestroyed = event => {
    /* istanbul ignore next: context cleared is usually called first */
    if (this.#contextId === event.executionContextId) {
      this.#contextId = null;
    }
  }

  _handleExecutionContextsCleared = () => {
    this.#contextId = null;
  }

  _handleTargetCrashed = () => {
    this.closedReason = 'Page crashed!';
    this.close();
  }
}
