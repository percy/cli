import EventEmitter from 'events';
import logger from '@percy/logger';
import { pendingCommand, DEFAULT_CDP_CLOSE_TIMEOUT } from './utils.js';

export class Session extends EventEmitter {
  #callbacks = new Map();

  log = logger('core:session');
  children = new Map();

  constructor(browser, { params, sessionId: parentId }) {
    super();

    this.browser = browser;
    this.sessionId = params.sessionId;
    this.targetId = params.targetInfo.targetId;
    this.type = params.targetInfo.type;
    this.isDocument = this.type === 'page' || this.type === 'iframe';
    this.parent = browser.sessions.get(parentId);
    this.parent?.children.set(this.sessionId, this);

    this.on('Inspector.targetCrashed', this._handleTargetCrashed);
  }

  async close() {
    // Check for the new closeBrowser option
    if (this.browser?.percy.config.discovery?.launchOptions?.closeBrowser === false) {
      this.log.debug('Skipping session close due to closeBrowser:false option');
      return true;
    }

    if (!this.browser || this.closing) return;
    this.closing = true;

    await this.browser.send('Target.closeTarget', {
      targetId: this.targetId
    }, { timeout: DEFAULT_CDP_CLOSE_TIMEOUT }).catch(this._handleClosedError);
  }

  async send(method, params, { timeout } = {}) {
    /* istanbul ignore next: race condition paranoia */
    if (this.closedReason) {
      throw new Error(`Protocol error (${method}): ${this.closedReason}`);
    }

    // send a raw message to the browser so we can provide a sessionId
    let id = await this.browser.send({ sessionId: this.sessionId, method, params });

    return pendingCommand(this.#callbacks, id, method, timeout);
  }

  _handleMessage(data) {
    if (data.id && this.#callbacks.has(data.id)) {
      // resolve or reject a pending promise created with #send()
      let callback = this.#callbacks.get(data.id);
      this.#callbacks.delete(data.id);
      clearTimeout(callback.timer);

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
    this.closedReason ||= 'Session closed.';

    for (let callback of this.#callbacks.values()) {
      clearTimeout(callback.timer);

      callback.reject(Object.assign(callback.error, {
        message: `Protocol error (${callback.method}): ${this.closedReason}`
      }));
    }

    this.#callbacks.clear();
    this.parent?.children.delete(this.sessionId);
    this.browser = null;
  }

  _handleTargetCrashed = () => {
    this.closedReason = 'Session crashed!';
    this.close();
  }

  /* istanbul ignore next: encountered during closing races */
  _handleClosedError = error => {
    if (!(error.message ?? error).endsWith(this.closedReason)) {
      this.log.debug(error, this.meta);
    }
  }
}

export default Session;
