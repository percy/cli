import EventEmitter from 'events';
import Network from './network';
import assert from '../utils/assert';

export default class Page extends EventEmitter {
  #browser = null;
  #sessionId = null;
  #targetId = null;
  #frameId = null;
  #contextId = null;
  #callbacks = new Map();

  constructor(browser, { params }) {
    super();

    this.#browser = browser;
    this.#sessionId = params.sessionId;
    this.#targetId = params.targetInfo.targetId;

    this.network = new Network(this);

    this.on('Runtime.executionContextCreated', this._handleExecutionContextCreated);
    this.on('Runtime.executionContextDestroyed', this._handleExecutionContextDestroyed);
    this.on('Runtime.executionContextsCleared', this._handleExecutionContextsCleared);

    this.send('Page.getFrameTree')
      .then(({ frameTree }) => (this.#frameId = frameTree.frame.id))
      .then(() => this.send('Runtime.enable'));
  }

  // Close the target page if not already closed
  async close() {
    assert(this.#browser, 'Page already closed.');

    await this.#browser.send('Target.closeTarget', {
      targetId: this.#targetId
    });

    this.#browser = null;
  }

  async eval(fn, args = []) {
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
