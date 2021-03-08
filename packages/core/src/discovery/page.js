import EventEmitter from 'events';
import logger from '@percy/logger';
import Network from './network';
import waitFor from '../utils/wait-for';

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

  constructor(browser, { params }) {
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
  }

  // initial page options asynchronously
  async init({ meta }) {
    this.meta = meta;
    this.log.debug('Initialize page', this.meta);

    let [, { frameTree }] = await Promise.all([
      this.send('Page.enable'),
      this.send('Page.getFrameTree')
    ]);

    this.#frameId = frameTree.frame.id;

    await Promise.all([
      this.send('Runtime.enable'),
      this.send('Page.setLifecycleEventsEnabled', {
        enabled: true
      })
    ]);

    return this;
  }

  // Close the target page if not already closed
  async close() {
    if (!this.#browser) return;

    await this.#browser.send('Target.closeTarget', {
      targetId: this.#targetId
    });
  }

  // Go to a URL and wait for navigation to occur
  async goto(url, {
    timeout = 30000,
    waitUntil = 'load',
    waitForTimeout,
    waitForSelector
  } = {}) {
    let handleNavigate = event => {
      /* istanbul ignore next: sanity check */
      if (this.#frameId === event.frame.id) handleNavigate.done = true;
    };

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
      }, { timeout })]);
    } catch (error) {
      this.off('Page.frameNavigated', handleNavigate);

      throw Object.assign(error, {
        message: `Navigation failed: ${error.message}`
      });
    }

    this.log.debug('Page navigated', this.meta);
    // wait for the network to idle
    await this.network.idle();

    // wait for any specified timeout
    if (waitForTimeout) {
      this.log.debug('Wait for page timeout', this.meta);

      await new Promise(resolve => {
        setTimeout(resolve, waitForTimeout);
      });
    }

    // wait for any specified selector
    if (waitForSelector) {
      this.log.debug('Wait for page selector', this.meta);

      /* istanbul ignore next: no instrumenting injected code */
      await this.eval(function waitForSelector({ waitFor }, selector, timeout) {
        return waitFor(() => !!document.querySelector(selector), timeout)
          .catch(() => Promise.reject(new Error(`Failed to find "${selector}"`)));
      }, waitForSelector, timeout);
    }
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

      if (data.error) {
        callback.reject(Object.assign(callback.error, {
          message: `Protocol error (${callback.method}): ${data.error.message}` +
            /* istanbul ignore next: doesn't always exist so don't print undefined */
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
    /* istanbul ignore next: racey with browser close */
    this.close().catch(error => this.log.debug(error));
  }
}
