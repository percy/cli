import fs from 'fs';
import os from 'os';
import path from 'path';
import spawn from 'cross-spawn';
import EventEmitter from 'events';
import WebSocket from 'ws';
import rimraf from 'rimraf';
import logger from '@percy/logger';
import install from './install.js';
import Session from './session.js';
import Page from './page.js';

export class Browser extends EventEmitter {
  log = logger('core:browser');
  sessions = new Map();
  readyState = null;
  closed = false;

  // Shared browser process for test environments. When enabled via
  // PERCY_BROWSER_REUSE=true, the first launch() spawns Chromium and
  // subsequent launches reconnect to the same process via its DevTools
  // WebSocket URL. close() disconnects the socket but leaves the
  // process alive. Call Browser.closeShared() to actually terminate it.
  static _sharedAddress = null;
  static _sharedProcess = null;
  static _sharedProfile = null;

  #callbacks = new Map();
  #lastid = 0;

  args = [
    // disable the translate popup and optimization downloads
    '--disable-features=Translate,OptimizationGuideModelDownloading',
    // disable several subsystems which run network requests in the background
    '--disable-background-networking',
    // disable task throttling of timer tasks from background pages
    '--disable-background-timer-throttling',
    // disable backgrounding renderer processes
    '--disable-renderer-backgrounding',
    // disable backgrounding renderers for occluded windows (reduce nondeterminism)
    '--disable-backgrounding-occluded-windows',
    // disable crash reporting
    '--disable-breakpad',
    // disable client side phishing detection
    '--disable-client-side-phishing-detection',
    // disable default component extensions with background pages for performance
    '--disable-component-extensions-with-background-pages',
    // disable installation of default apps on first run
    '--disable-default-apps',
    // work-around for environments where a small /dev/shm partition causes crashes
    '--disable-dev-shm-usage',
    // disable extensions
    '--disable-extensions',
    // disable hang monitor dialogs in renderer processes
    '--disable-hang-monitor',
    // disable inter-process communication flooding protection for javascript
    '--disable-ipc-flooding-protection',
    // disable web notifications and the push API
    '--disable-notifications',
    // disable the prompt when a POST request causes page navigation
    '--disable-prompt-on-repost',
    // disable syncing browser data with google accounts
    '--disable-sync',
    // disable site-isolation to make network requests easier to intercept
    '--disable-site-isolation-trials',
    // disable the first run tasks, whether or not it's actually the first run
    '--no-first-run',
    // disable the sandbox for all process types that are normally sandboxed
    '--no-sandbox',
    // enable indication that browser is controlled by automation
    '--enable-automation',
    // specify a consistent encryption backend across platforms
    '--password-store=basic',
    // use a mock keychain on Mac to prevent blocking permissions dialogs
    '--use-mock-keychain',
    // enable remote debugging on the first available port
    '--remote-debugging-port=0'
  ];

  constructor(percy) {
    super().percy = percy;
  }

  async launch() {
    // already launching or launched
    if (this.readyState != null) return;
    this.readyState = 0;

    let { cookies = [], launchOptions } = this.percy.config.discovery;
    let { executable, headless = true, args = [], timeout } = launchOptions;
    executable ??= process.env.PERCY_BROWSER_EXECUTABLE;

    // transform cookies object to an array of cookie params
    this.cookies = Array.isArray(cookies) ? cookies : (
      Object.entries(cookies).map(([name, value]) => ({ name, value })));

    // Reuse a shared browser process when PERCY_BROWSER_REUSE is enabled.
    // This avoids re-spawning Chromium on every Percy.start()/stop() cycle,
    // saving ~15-25s per launch on Windows and ~3-5s on Linux.
    let reuse = process.env.PERCY_BROWSER_REUSE === 'true';
    if (reuse && Browser._sharedAddress && Browser._sharedProcess && !Browser._sharedProcess.exitCode) {
      this.process = Browser._sharedProcess;
      this.profile = Browser._sharedProfile;
      this.address = Browser._sharedAddress;
      this.log.debug('Reusing shared browser process');
      this.ws = new WebSocket(this.address, { perMessageDeflate: false });
      await new Promise(resolve => this.ws.once('open', resolve));
      this.ws.on('message', data => this._handleMessage(data));
      this.version = await this.send('Browser.getVersion');
      this.log.debug(`Browser reconnected [${this.process.pid}]: ${this.version.product}`);
      this.readyState = 1;
      return;
    }

    // check if any provided executable exists
    if (executable && !fs.existsSync(executable)) {
      this.log.error(`Browser executable not found: ${executable}`);
      executable = null;
    }

    // download and install the browser if not already present
    this.executable = executable || await install.chromium();
    this.log.debug('Launching browser');

    // create a temporary profile directory and collect additional launch arguments
    this.profile = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'percy-browser-'));
    /* istanbul ignore next: only false for debugging */
    if (headless) this.args.push('--headless', '--hide-scrollbars', '--mute-audio');
    for (let a of args) if (!this.args.includes(a)) this.args.push(a);
    this.args.push(`--user-data-dir=${this.profile}`);

    // spawn the browser process and connect a websocket to the devtools address
    this.ws = new WebSocket(await this.spawn(timeout), { perMessageDeflate: false });

    // wait until the websocket has connected
    await new Promise(resolve => this.ws.once('open', resolve));
    this.ws.on('message', data => this._handleMessage(data));

    // get version information
    this.version = await this.send('Browser.getVersion');

    this.log.debug(`Browser connected [${this.process.pid}]: ${this.version.product}`);
    this.readyState = 1;

    // Save references for subsequent reuse and register exit cleanup
    if (reuse && !Browser._sharedAddress) {
      Browser._sharedAddress = this.address;
      Browser._sharedProcess = this.process;
      Browser._sharedProfile = this.profile;
      Browser._registerExitCleanup();
    }
  }

  // Terminate the shared browser process. Called automatically on process
  // exit (registered on first shared-mode launch).
  static async closeShared() {
    if (Browser._sharedProcess && !Browser._sharedProcess.exitCode) {
      try { Browser._sharedProcess.kill('SIGKILL'); } catch {}
      if (Browser._sharedProfile) {
        await new Promise(r => rimraf(Browser._sharedProfile, () => r())).catch(() => {});
      }
    }
    Browser._sharedAddress = null;
    Browser._sharedProcess = null;
    Browser._sharedProfile = null;
  }

  static _exitHandlerRegistered = false;
  static _registerExitCleanup() {
    if (Browser._exitHandlerRegistered) return;
    Browser._exitHandlerRegistered = true;
    let cleanup = () => {
      if (Browser._sharedProcess && !Browser._sharedProcess.exitCode) {
        try { Browser._sharedProcess.kill('SIGKILL'); } catch {}
      }
    };
    process.once('exit', cleanup);
    process.once('SIGINT', () => { cleanup(); process.exit(130); });
    process.once('SIGTERM', () => { cleanup(); process.exit(143); });
  }

  isConnected() {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  async restart() {
    this.log.info('Restarting browser after disconnection');

    // Force close the existing browser instance
    /* istanbul ignore next: Hard to mock */
    if (this.readyState !== null) {
      await this.close(true).catch(err => {
        this.log.debug('Error during force close:', err);
      });
    }

    // Reset state for fresh launch
    this.readyState = null;
    this._closed = null;
    this.#callbacks.clear();
    this.sessions.clear();

    // Launch a new browser instance
    await this.launch();
    this.log.info('Browser restarted successfully');
  }

  async close(force = false) {
    // Check for the new closeBrowser option
    if (!force && this.percy.config.discovery?.launchOptions?.closeBrowser === false) {
      this.log.debug('Skipping browser close due to closeBrowser:false option');
      return true;
    }

    // When reusing a shared browser, disconnect the WebSocket but keep
    // the process alive for the next Percy instance to reconnect to.
    let reuse = process.env.PERCY_BROWSER_REUSE === 'true';
    if (reuse && Browser._sharedProcess && this.process === Browser._sharedProcess && !force) {
      this.log.debug('Disconnecting from shared browser (process kept alive)');
      // close all browser contexts to avoid state leaking between tests
      try {
        let { browserContextIds } = await this.send('Target.getBrowserContexts');
        for (let id of (browserContextIds || [])) {
          await this.send('Target.disposeBrowserContext', { browserContextId: id }).catch(() => {});
        }
      } catch (e) { /* browser may already be disconnecting */ }

      for (let session of this.sessions.values()) session._handleClose();
      this.#callbacks.clear();
      this.sessions.clear();
      this.ws?.close();
      this.readyState = null;
      this._closed = null;
      return;
    }

    // not running, already closed, or closing
    if (this._closed) return this._closed;
    this.readyState = 2;

    this.log.debug('Closing browser');

    // resolves when the browser has closed
    this._closed = Promise.all([
      new Promise(resolve => {
        /* istanbul ignore next: race condition paranoia */
        if (!this.process || this.process.exitCode) resolve();
        else this.process.on('exit', resolve);
      }),
      new Promise(resolve => {
        /* istanbul ignore next: race condition paranoia */
        if (!this.isConnected()) resolve();
        else this.ws.on('close', resolve);
      })
    ]).then(() => {
      /* istanbul ignore next:
       *   this might fail on some systems but ultimately it is just a temp file */
      if (this.profile) {
        // attempt to clean up the profile directory
        return new Promise((resolve, reject) => {
          rimraf(this.profile, e => e ? reject(e) : resolve());
        }).catch(error => {
          this.log.debug('Could not clean up temporary browser profile directory.');
          this.log.debug(error);
        });
      }
    }).then(() => {
      this.log.debug('Browser closed');
      this.readyState = 3;
    });

    // reject any pending callbacks
    for (let callback of this.#callbacks.values()) {
      callback.reject(Object.assign(callback.error, {
        message: `Protocol error (${callback.method}): Browser closed.`
      }));
    }

    // trigger rejecting pending session callbacks
    for (let session of this.sessions.values()) {
      session._handleClose();
    }

    // clear own callbacks and sessions
    this.#callbacks.clear();
    this.sessions.clear();

    /* istanbul ignore next:
     *   difficult to test failure here without mocking private properties */
    if (this.process?.pid && !this.process.killed) {
      // always force close the browser process
      try { this.process.kill('SIGKILL'); } catch (error) {
        throw new Error(`Unable to close the browser: ${error.stack}`);
      }
    }

    // close the socket connection
    this.ws?.close();

    // wait for the browser to close
    return this._closed;
  }

  async page(options = {}) {
    // Check if browser is connected, restart if needed
    if (!this.isConnected()) {
      this.log.warn('Browser disconnected, attempting restart');
      await this.restart();
    }

    // Create an isolated browser context per page so cookies/storage
    // don't leak between concurrent snapshot discovery pages
    let { browserContextId } = await this.send(
      'Target.createBrowserContext', { disposeOnDetach: true }
    );

    let { targetId } = await this.send('Target.createTarget', { url: '', browserContextId });
    let { sessionId } = await this.send('Target.attachToTarget', { targetId, flatten: true });
    let page = new Page(this.sessions.get(sessionId), options);
    page.browserContextId = browserContextId;
    await page._handleAttachedToTarget();
    return page;
  }

  async send(method, params) {
    /* istanbul ignore next:
     *   difficult to test failure here without mocking private properties */
    if (!this.isConnected()) throw new Error('Browser not connected');

    // every command needs a unique id
    let id = ++this.#lastid;

    if (!params && typeof method === 'object') {
      // allow providing a raw message as the only argument and return the id
      this.ws.send(JSON.stringify({ ...method, id }));
      return id;
    } else {
      // send the message payload
      this.ws.send(JSON.stringify({ id, method, params }));

      // will resolve or reject when a matching response is received
      return new Promise((resolve, reject) => {
        this.#callbacks.set(id, { error: new Error(), resolve, reject, method });
      });
    }
  }

  async spawn(timeout = 30000) {
    // spawn the browser process detached in its own group and session
    this.process = spawn(this.executable, this.args, {
      detached: process.platform !== 'win32'
    });

    // watch the process stderr and resolve when it emits the devtools protocol address
    this.address = await new Promise((resolve, reject) => {
      let stderr = '';

      let handleData = chunk => {
        stderr += (chunk = chunk.toString());
        let match = chunk.match(/^DevTools listening on (ws:\/\/.*)$/m);
        if (match) cleanup(() => resolve(match[1]));
      };

      let handleExitClose = () => handleError();
      let handleError = error => cleanup(() => reject(new Error(
        `Failed to launch browser. ${error?.message ?? ''}\n${stderr}'\n\n`
      )));

      let cleanup = callback => {
        clearTimeout(timeoutId);
        this.process.stderr.off('data', handleData);
        this.process.stderr.off('close', handleExitClose);
        this.process.off('exit', handleExitClose);
        this.process.off('error', handleError);
        callback();
      };

      let timeoutId = setTimeout(() => handleError(
        new Error(`Timed out after ${timeout}ms`)
      ), timeout);

      this.process.stderr.on('data', handleData);
      this.process.stderr.on('close', handleExitClose);
      this.process.on('exit', handleExitClose);
      this.process.on('error', handleError);
    });

    return this.address;
  }

  _handleMessage(data) {
    data = JSON.parse(data);

    if (data.method === 'Target.attachedToTarget') {
      // create a new session reference when attached to a target
      let session = new Session(this, data);
      this.sessions.set(session.sessionId, session);
    } else if (data.method === 'Target.detachedFromTarget') {
      // remove the old session reference when detached from a target
      let session = this.sessions.get(data.params.sessionId);
      this.sessions.delete(data.params.sessionId);
      session?._handleClose();
    }

    if (data.sessionId) {
      // message was for a specific session that sent it
      let session = this.sessions.get(data.sessionId);
      session?._handleMessage(data);
    } else if (data.id && this.#callbacks.has(data.id)) {
      // resolve or reject a pending promise created with #send()
      let callback = this.#callbacks.get(data.id);
      this.#callbacks.delete(data.id);

      /* istanbul ignore next: races with page._handleMessage() */
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
}

export default Browser;
