import fs from 'fs';
import logger from '@percy/logger';
import Network from './network.js';
import { PERCY_DOM } from './api.js';
import {
  hostname,
  waitFor,
  waitForTimeout as sleep,
  serializeFunction
} from './utils.js';

export class Page {
  static TIMEOUT = 30000;

  log = logger('core:page');

  constructor(session, options) {
    this.session = session;
    this.browser = session.browser;
    this.enableJavaScript = options.enableJavaScript ?? true;
    this.network = new Network(this, options);
    this.meta = options.meta;

    session.on('Runtime.executionContextCreated', this._handleExecutionContextCreated);
    session.on('Runtime.executionContextDestroyed', this._handleExecutionContextDestroyed);
    session.on('Runtime.executionContextsCleared', this._handleExecutionContextsCleared);
    session.send('Runtime.enable').catch(session._handleClosedError);

    this.log.debug('Page created');
  }

  // Close the page
  async close() {
    await this.session.close();
    this.log.debug('Page closed', this.meta);
  }

  async reload() {
    await this.session.send('Page.reload');
    this.log.debug('Page reloaded', this.meta);
  }

  // Resize the page to the specified width and height
  async resize({ width, height, deviceScaleFactor = 1, mobile = false }) {
    this.log.debug(`Resize page to ${width}x${height} at ${deviceScaleFactor}x scale`);

    await this.session.send('Emulation.setDeviceMetricsOverride', {
      deviceScaleFactor,
      mobile,
      height,
      width
    });
  }

  // Go to a URL and wait for navigation to occur
  async goto(url, { waitUntil = 'load' } = {}) {
    this.log.debug(`Navigate to: ${url}`, this.meta);

    let navigate = async () => {
      // set cookies before navigation so we can default the domain to this hostname
      if (this.session.browser.cookies.length) {
        let defaultDomain = hostname(url);

        await this.session.send('Network.setCookies', {
          // spread is used to make a shallow copy of the cookie
          cookies: this.session.browser.cookies.map(({ ...cookie }) => {
            if (!cookie.url) cookie.domain ||= defaultDomain;
            return cookie;
          })
        });
      }

      // handle navigation errors
      let res = await this.session.send('Page.navigate', { url });
      if (res.errorText) throw new Error(res.errorText);
    };

    let handlers = [
      // wait until navigation and the correct lifecycle
      ['Page.frameNavigated', e => this.session.targetId === e.frame.id],
      ['Page.lifecycleEvent', e => this.session.targetId === e.frameId && e.name === waitUntil]
    ].map(([name, cond]) => {
      let handler = e => cond(e) && (handler.finished = true) && handler.off();
      handler.off = () => this.session.off(name, handler);
      this.session.on(name, handler);
      return handler;
    });

    try {
      // trigger navigation and poll for handlers to have finished
      await Promise.all([navigate(), waitFor(() => {
        if (this.session.closedReason) throw new Error(this.session.closedReason);
        return handlers.every(handler => handler.finished);
      }, Page.TIMEOUT)]);
    } catch (error) {
      // remove handlers and modify the error message
      for (let handler of handlers) handler.off();

      throw Object.assign(error, {
        message: `Navigation failed: ${error.message}`
      });
    }

    this.log.debug('Page navigated', this.meta);
  }

  // Evaluate JS functions within the page's execution context
  async eval(fn, ...args) {
    let { result, exceptionDetails } =
      await this.session.send('Runtime.callFunctionOn', {
        functionDeclaration: serializeFunction(fn),
        arguments: args.map(value => ({ value })),
        executionContextId: this.contextId,
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

  // Evaluate one or more scripts in succession
  async evaluate(scripts) {
    if (!(scripts &&= [].concat(scripts))?.length) return;
    this.log.debug('Evaluate JavaScript', { ...this.meta, scripts });
    for (let script of scripts) await this.eval(script);
  }

  // Take a snapshot after waiting for any timeout, waiting for any selector, executing any scripts,
  // and waiting for the network idle
  async snapshot({
    name,
    waitForTimeout,
    waitForSelector,
    execute,
    meta,
    ...options
  }) {
    this.log.debug(`Taking snapshot: ${name}`, this.meta);

    // wait for any specified timeout
    if (waitForTimeout) {
      this.log.debug(`Wait for ${waitForTimeout}ms timeout`, this.meta);
      await sleep(waitForTimeout);
    }

    // wait for any specified selector
    if (waitForSelector) {
      this.log.debug(`Wait for selector: ${waitForSelector}`, this.meta);
      await this.eval(`await waitForSelector(${JSON.stringify(waitForSelector)}, ${Page.TIMEOUT})`);
    }

    // execute any javascript
    if (execute) {
      let execBefore = typeof execute === 'object' && !Array.isArray(execute);
      await this.evaluate(execBefore ? execute.beforeSnapshot : execute);
    }

    // wait for any final network activity before capturing the dom snapshot
    await this.network.idle();

    // inject @percy/dom for serialization by evaluating the file contents which adds a global
    // PercyDOM object that we can later check against
    /* istanbul ignore next: no instrumenting injected code */
    if (await this.eval(() => !window.PercyDOM)) {
      this.log.debug('Inject @percy/dom', this.meta);
      let script = await fs.promises.readFile(PERCY_DOM, 'utf-8');
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

  // Initialize newly attached pages and iframes with page options
  _handleAttachedToTarget = event => {
    let session = !event ? this.session
      : this.session.children.get(event.sessionId);
    /* istanbul ignore if: sanity check */
    if (!session) return;

    let commands = [this.network.watch(session)];

    if (session.isDocument) {
      session.on('Target.attachedToTarget', this._handleAttachedToTarget);

      commands.push(
        session.send('Page.enable'),
        session.send('Page.setLifecycleEventsEnabled', { enabled: true }),
        session.send('Security.setIgnoreCertificateErrors', { ignore: true }),
        session.send('Emulation.setScriptExecutionDisabled', { value: !this.enableJavaScript }),
        session.send('Target.setAutoAttach', {
          waitForDebuggerOnStart: false,
          autoAttach: true,
          flatten: true
        }));
    }

    return Promise.all(commands)
      .catch(session._handleClosedError);
  }

  // Keep track of the page's execution context id
  _handleExecutionContextCreated = event => {
    if (this.session.targetId === event.context.auxData.frameId) {
      this.contextId = event.context.id;

      // inject global percy config as soon as possible
      this.eval(`window.__PERCY__ = ${
        JSON.stringify({ config: this.browser.percy.config })
      };`).catch(this.session._handleClosedError);
    }
  }

  _handleExecutionContextDestroyed = event => {
    /* istanbul ignore next: context cleared is usually called first */
    if (this.contextId === event.executionContextId) {
      this.contextId = null;
    }
  }

  _handleExecutionContextsCleared = () => {
    this.contextId = null;
  }
}

export default Page;
