import os from 'os';
import path from 'path';
import { promises as fs, existsSync } from 'fs';
import spawn from 'cross-spawn';
import EventEmitter from 'events';
import WebSocket from 'ws';
import rimraf from 'rimraf';
import logger from '@percy/logger';
import install from './install';
import Session from './session';
import Page from './page';

export default class Browser extends EventEmitter {
  log = logger('core:browser');
  sessions = new Map();
  closed = false;

  #callbacks = new Map();
  #lastid = 0;

  args = [
    // disable the translate popup
    '--disable-features=Translate',
    // disable several subsystems which run network requests in the background
    '--disable-background-networking',
    // disable task throttling of timer tasks from background pages
    '--disable-background-timer-throttling',
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

  constructor({
    executable = process.env.PERCY_BROWSER_EXECUTABLE,
    headless = true,
    cookies = [],
    args = [],
    timeout
  }) {
    super();

    this.launchTimeout = timeout;
    this.executable = executable;
    this.headless = headless;

    /* istanbul ignore next: only false for debugging */
    if (this.headless) this.args.push('--headless', '--hide-scrollbars', '--mute-audio');
    for (let a of args) if (!this.args.includes(a)) this.args.push(a);

    // transform cookies object to an array of cookie params
    this.cookies = Array.isArray(cookies) ? cookies
      : Object.entries(cookies).map(([name, value]) => ({ name, value }));
  }

  async launch() {
    if (this.isConnected()) return;

    // check if any provided executable exists
    if (this.executable && !existsSync(this.executable)) {
      this.log.error(`Browser executable not found: ${this.executable}`);
      this.executable = null;
    }

    // download and install the browser if not already present
    this.executable ||= await install.chromium();
    // create a temporary profile directory
    this.profile = await fs.mkdtemp(path.join(os.tmpdir(), 'percy-browser-'));

    // collect args to pass to the browser process
    let args = [...this.args, `--user-data-dir=${this.profile}`];

    // spawn the browser process detached in its own group and session
    this.process = spawn(this.executable, args, {
      detached: process.platform !== 'win32'
    });

    // connect a websocket to the devtools address
    let addr = await this.address(this.launchTimeout);
    this.ws = new WebSocket(addr, { perMessageDeflate: false });

    // wait until the websocket has connected
    await new Promise(resolve => this.ws.once('open', resolve));
    this.ws.on('message', data => this._handleMessage(data));

    // get version information
    this.version = await this.send('Browser.getVersion');
  }

  isConnected() {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  async close() {
    if (this._closed) return this._closed;

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
      // needed due to a bug in Node 12 - https://github.com/nodejs/node/issues/27097
      this.process?.stdin.end();
      this.process?.stdout.end();
      this.process?.stderr.end();

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
    let { targetId } = await this.send('Target.createTarget', { url: '' });
    let { sessionId } = await this.send('Target.attachToTarget', { targetId, flatten: true });
    let page = new Page(this.sessions.get(sessionId), options);
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

  // Returns the devtools websocket address. If not already known, will watch the browser's
  // stderr and resolves when it emits the devtools protocol address or rejects if the process
  // exits for any reason or if the address does not appear after the timeout.
  async address(timeout = 30000) {
    this._address ||= await new Promise((resolve, reject) => {
      let stderr = '';

      let handleData = chunk => {
        stderr += (chunk = chunk.toString());
        let match = chunk.match(/^DevTools listening on (ws:\/\/.*)$/m);
        if (match) cleanup(() => resolve(match[1]));
      };

      /* istanbul ignore next: for sanity */
      let handleExit = () => handleError();
      let handleClose = () => handleError();
      let handleError = error => {
        cleanup(() => reject(new Error(
          `Failed to launch browser. ${error?.message ?? ''}\n${stderr}'\n\n`
        )));
      };

      let cleanup = callback => {
        clearTimeout(timeoutId);
        this.process.stderr.off('data', handleData);
        this.process.stderr.off('close', handleClose);
        this.process.off('exit', handleExit);
        this.process.off('error', handleError);
        callback();
      };

      let timeoutId = setTimeout(() => handleError(
        new Error(`Timed out after ${timeout}ms`)
      ), timeout);

      this.process.stderr.on('data', handleData);
      this.process.stderr.on('close', handleClose);
      this.process.on('exit', handleExit);
      this.process.on('error', handleError);
    });

    return this._address;
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
      this.sessions.delete(session.sessionId);
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
