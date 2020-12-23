import EventEmitter from 'events';
import Network from './network';
import assert from '../utils/assert';
import waitFor from '../utils/wait-for';

export default class Page extends EventEmitter {
  #browser = null;
  #sessionId = null;
  #targetId = null;
  #frameId = null;
  #contextId = null;

  #callbacks = new Map();
  #lifecycle = new Set();

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
  }

  // initial page options asynchronously
  async init() {
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
    waitUntil = 'load'
  } = {}) {
    let handleNavigate = ({ frame }) => {
      /* istanbul ignore next: sanity check */
      if (this.#frameId === frame.id) handleNavigate.done = true;
    };

    this.once('Page.frameNavigated', handleNavigate);

    try {
      await Promise.all([
        this.send('Page.navigate', { url }).then(({ errorText }) => {
          if (errorText) throw new Error(errorText);
        }),
        waitFor(() => {
          return handleNavigate.done &&
            this.#lifecycle.has(waitUntil);
        }, { timeout })
      ]);
    } catch (error) {
      this.off('Page.frameNavigated', handleNavigate);

      throw Object.assign(error, {
        message: `Navigation failed: ${error.message}`
      });
    }
  }

  // Evaluate JS functions within the page's execution context
  async eval(fn, ...args) {
    let { result, exceptionDetails } = await this.send('Runtime.callFunctionOn', {
      functionDeclaration: fn.toString(),
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
    assert(this.#browser, `Protocol error (${method}): Page closed.`);

    // send a raw message to the browser so we can provide a sessionId
    let id = this.#browser.send({ sessionId: this.#sessionId, method, params });

    // return a promise that will resolve or reject when a response is received
    return new Promise((resolve, reject) => {
      this.#callbacks.set(id, { error: new Error(), resolve, reject, method });
    });
  }

  _handleMessage(data) {
    if (data.id && this.#callbacks.has(data.id)) {
      // resolve or reject a pending promise created with #send()
      let callback = this.#callbacks.get(data.id);
      this.#callbacks.delete(data.id);

      if (data.error) {
        callback.reject(Object.assign(callback.error, {
          message: `Protocol error (${callback.method}): ${data.error.message}${
            'data' in data.error ? ` ${data.error.data}` : ''
          }`
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
    // reject any pending callbacks
    for (let callback of this.#callbacks.values()) {
      callback.reject(Object.assign(callback.error, {
        message: `Protocol error (${callback.method}): Page closed.`
      }));
    }

    // clear callbacks and browser references
    this.#callbacks.clear();
    this.#browser = null;
  }

  _handleLifecycleEvent = ({ frameId, loaderId, name }) => {
    if (this.#frameId === frameId) {
      if (name === 'init') this.#lifecycle.clear();
      this.#lifecycle.add(name);
    }
  }

  _handleExecutionContextCreated = ({ context }) => {
    if (this.#frameId === context.auxData.frameId) {
      this.#contextId = context.id;
    }
  }

  _handleExecutionContextDestroyed = ({ executionContextId }) => {
    if (this.#contextId === executionContextId) {
      this.#contextId = null;
    }
  }

  _handleExecutionContextsCleared = () => {
    this.#contextId = null;
  }
}
