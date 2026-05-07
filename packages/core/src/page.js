import fs from 'fs';
import path from 'path';
import url from 'url';
import logger from '@percy/logger';
import Network from './network.js';
import { PERCY_DOM } from './api.js';
import {
  hostname,
  waitFor,
  waitForTimeout as sleep,
  serializeFunction
} from './utils.js';

// Default ceiling on the customElements wait. Users may override via the
// snapshot option of the same name. Set high enough to cover lazy-defined
// element cascades on slow networks; the loop exits early when no more
// undefined elements remain.
export const DEFAULT_WAIT_FOR_CUSTOM_ELEMENTS_TIMEOUT = 1500;

// Read preflight.js synchronously at module load. The build copies src to
// dist and preflight.js sits next to this file in both layouts, so a single
// relative resolve works in both. Synchronous load eliminates file I/O from
// the critical CDP path so addScriptToEvaluateOnNewDocument dispatches in
// the same event-loop tick as Page.enable's response.
export function loadPreflightScript() {
  try {
    let here = path.dirname(url.fileURLToPath(import.meta.url));
    return fs.readFileSync(path.join(here, 'preflight.js'), 'utf-8');
  } catch (err) {
    logger('core:page').warn(
      `[fidelity] Preflight script unavailable, closed shadow DOM and custom-element :state() capture disabled: ${err.message}`
    );
    return '';
  }
}

const PREFLIGHT_SCRIPT = loadPreflightScript();

// Surfaces unexpected preflight injection failures at debug level. Errors
// caused by the target being closed/destroyed mid-attach are quietly
// swallowed since they are normal during teardown.
export function handlePreflightInjectionError(err) {
  let msg = err && err.message;
  if (msg && (msg.includes('closed') || msg.includes('destroyed'))) return;
  logger('core:page').debug(`Preflight script injection failed: ${msg || err}`);
}

// Body of the customElements wait. Kept as a JS string (not an inline
// function) so nyc/istanbul does not instrument the body and we don't need
// an istanbul-ignore. The body runs in the browser via Runtime.callFunctionOn.
//
// Re-polls on each tick so lazy-defined element cascades (one definition
// triggering another via dynamic import) are awaited up to the deadline.
export const WAIT_FOR_CUSTOM_ELEMENTS_BODY = [
  'var deadline = Date.now() + (arguments[0] || 1500);',
  'return new Promise(function(resolve) {',
  '  function tick() {',
  '    var undef = document.querySelectorAll(":not(:defined)");',
  '    if (!undef.length) return resolve();',
  '    if (Date.now() >= deadline) return resolve();',
  '    var names = {};',
  '    for (var i = 0; i < undef.length; i++) names[undef[i].localName] = true;',
  '    var promises = Object.keys(names).map(function(n) {',
  '      return window.customElements.whenDefined(n).catch(function(){});',
  '    });',
  '    Promise.race([',
  '      Promise.all(promises),',
  '      new Promise(function(r) { setTimeout(r, 100); })',
  '    ]).then(tick);',
  '  }',
  '  tick();',
  '});'
].join('\n');

export class Page {
  static TIMEOUT = undefined;

  log = logger('core:page');

  constructor(session, options) {
    this.session = session;
    this.browser = session.browser;
    this.enableJavaScript = options.enableJavaScript ?? true;
    this.network = new Network(this, options);
    this.meta = options.meta;
    this._initializeLoadTimeout();

    session.on('Runtime.executionContextCreated', this._handleExecutionContextCreated);
    session.on('Runtime.executionContextDestroyed', this._handleExecutionContextDestroyed);
    session.on('Runtime.executionContextsCleared', this._handleExecutionContextsCleared);
    session.send('Runtime.enable').catch(session._handleClosedError);

    this.log.debug('Page created', this.meta);
  }

  // Close the page
  async close() {
    let browser = this.session.browser;
    await this.session.close();

    if (this.browserContextId && browser) {
      /* istanbul ignore next: safety net for already-disposed contexts */
      await browser.send('Target.disposeBrowserContext', {
        browserContextId: this.browserContextId
      }).catch(() => {});
    }

    this.log.debug('Page closed', this.meta);
  }

  // Resize the page to the specified width and height
  async resize({ width, height, deviceScaleFactor = 1, mobile = false }) {
    this.log.debug(`Resize page to ${width}x${height} @${deviceScaleFactor}x`, this.meta);

    await this.session.send('Emulation.setDeviceMetricsOverride', {
      deviceScaleFactor,
      mobile,
      height,
      width
    });
  }

  mergeCookies(userPassedCookie, autoCapturedCookie) {
    if (!autoCapturedCookie) return userPassedCookie;
    if (userPassedCookie.length === 0) return autoCapturedCookie;

    // User passed cookie will be prioritized over auto captured cookie
    const mergedCookies = [...userPassedCookie, ...autoCapturedCookie];
    const uniqueCookies = [];
    const names = new Set();

    for (const cookie of mergedCookies) {
      if (!names.has(cookie.name)) {
        uniqueCookies.push(cookie);
        names.add(cookie.name);
      }
    }

    return uniqueCookies;
  }

  // Go to a URL and wait for navigation to occur
  async goto(url, { waitUntil = 'load', cookies, forceReload, skipCookies = false } = {}) {
    this.log.debug(`Navigate to: ${url}`, this.meta);

    if (forceReload) {
      this.log.debug('Navigating to blank page', this.meta);
      await this.goto('about:blank', { skipCookies: true });
    }

    let navigate = async () => {
      const userPassedCookie = this.session.browser.cookies;
      // set cookies before navigation so we can default the domain to this hostname
      if (!skipCookies && (userPassedCookie.length || cookies)) {
        let defaultDomain = hostname(url);
        cookies = this.mergeCookies(userPassedCookie, cookies);

        await this.session.send('Network.setCookies', {
          // spread is used to make a shallow copy of the cookie
          cookies: cookies.map(({ ...cookie }) => {
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
      // remove any unused handlers
      for (let handler of handlers) handler.off();

      // assign context to unknown errors
      if (!error.message.startsWith('Timeout')) {
        throw Object.assign(error, { message: `Navigation failed: ${error.message}` });
      }

      // throw a network error to show active requests
      this.network._throwTimeoutError(
        `Navigation failed: Timed out waiting for the page ${waitUntil} event`
      );
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

  async insertPercyDom() {
    // inject @percy/dom for serialization by evaluating the file contents which adds a global
    // PercyDOM object that we can later check against
    /* istanbul ignore next: no instrumenting injected code */
    if (await this.eval(() => !window.PercyDOM)) {
      this.log.debug('Inject @percy/dom', this.meta);
      let script = await fs.promises.readFile(PERCY_DOM, 'utf-8');
      await this.eval(new Function(script)); /* eslint-disable-line no-new-func */
    }
  }

  // Takes a snapshot after waiting for any timeout, waiting for any selector, executing any
  // scripts, and waiting for the network idle. Returns all other provided snapshot options along
  // with the captured URL and DOM snapshot.
  async snapshot({
    waitForTimeout,
    waitForSelector,
    execute,
    ...snapshot
  }) {
    let { name, width, enableJavaScript, disableShadowDOM, forceShadowAsLightDOM, domTransformation, reshuffleInvalidTags, ignoreCanvasSerializationErrors, ignoreStyleSheetSerializationErrors, ignoreIframeSelectors, pseudoClassEnabledElements, waitForCustomElementsTimeout } = snapshot;
    this.log.debug(`Taking snapshot: ${name}${width ? ` @${width}px` : ''}`, this.meta);

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

    // wait for custom elements to be defined before capturing. The body
    // re-polls each tick so lazy-defined element cascades are awaited up
    // to the user-configurable deadline.
    let waitTimeout = waitForCustomElementsTimeout ?? DEFAULT_WAIT_FOR_CUSTOM_ELEMENTS_TIMEOUT;
    await this.eval(WAIT_FOR_CUSTOM_ELEMENTS_BODY, waitTimeout);

    await this.insertPercyDom();

    // serialize and capture a DOM snapshot
    this.log.debug('Serialize DOM', this.meta);

    /* istanbul ignore next: no instrumenting injected code */
    let capture = await this.eval((_, options) => ({
      /* eslint-disable-next-line no-undef */
      domSnapshot: PercyDOM.serialize(options),
      url: document.URL
    }), { enableJavaScript, disableShadowDOM, forceShadowAsLightDOM, domTransformation, reshuffleInvalidTags, ignoreCanvasSerializationErrors, ignoreStyleSheetSerializationErrors, ignoreIframeSelectors, pseudoClassEnabledElements, waitForCustomElementsTimeout });

    return { ...snapshot, ...capture };
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

      // Chain preflight injection after Page.enable. CDP processes commands
      // FIFO per session — and since the preflight script was loaded
      // synchronously at module import, no event-loop turn elapses between
      // Page.enable's response and the addScript dispatch. Sent on every
      // attached document target so out-of-process iframes also receive
      // the patches.
      let pageEnablePromise = session.send('Page.enable');
      commands.push(
        PREFLIGHT_SCRIPT
          ? pageEnablePromise.then(() =>
            session.send('Page.addScriptToEvaluateOnNewDocument', { source: PREFLIGHT_SCRIPT })
              .catch(err => handlePreflightInjectionError(err))
          )
          : pageEnablePromise,
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

  _initializeLoadTimeout() {
    if (Page.TIMEOUT) return;

    Page.TIMEOUT = parseInt(process.env.PERCY_PAGE_LOAD_TIMEOUT) || 30000;

    if (Page.TIMEOUT > 60000) {
      this.log.warn('Setting PERCY_PAGE_LOAD_TIMEOUT over 60000ms is not recommended. ' +
        'If your page needs more than 60000ms to load due to CPU/Network load, ' +
        'its recommended to increase CI resources where this cli is running.');
    }
  }
}

export default Page;
