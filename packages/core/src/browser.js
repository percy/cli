import os from 'os';
import path from 'path';
import { promises as fs, existsSync } from 'fs';
import spawn from 'cross-spawn';
import EventEmitter from 'events';
import WebSocket from 'ws';
import rimraf from 'rimraf';
import logger from '@percy/logger';
import install from './install';
import Page from './page';

export default class Browser extends EventEmitter {
  log = logger('core:browser');
  pages = new Map();
  closed = false;

  #callbacks = new Map();
  #lastid = 0;

  defaultArgs = [
    '--enable-features=NetworkService,NetworkServiceInProcess',
    '--disable-background-networking',
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
    '--disable-breakpad',
    '--disable-client-side-phishing-detection',
    '--disable-component-extensions-with-background-pages',
    '--disable-default-apps',
    '--disable-dev-shm-usage',
    '--disable-extensions',
    '--disable-features=TranslateUI',
    '--disable-hang-monitor',
    '--disable-ipc-flooding-protection',
    '--disable-popup-blocking',
    '--disable-prompt-on-repost',
    '--disable-renderer-backgrounding',
    '--disable-sync',
    '--disable-web-security',
    '--force-color-profile=srgb',
    '--metrics-recording-only',
    '--no-first-run',
    '--no-sandbox',
    '--enable-automation',
    '--password-store=basic',
    '--use-mock-keychain',
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
    this.args = args;
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
    let args = [...this.defaultArgs, `--user-data-dir=${this.profile}`];
    /* istanbul ignore next: only false for debugging */
    if (this.headless) args.push('--headless', '--hide-scrollbars', '--mute-audio');
    for (let a of this.args) if (!args.includes(a)) args.push(a);

    // spawn the browser process detached in its own group and session
    this.process = spawn(this.executable, args, {
      detached: process.platform !== 'win32'
    });

    // connect a websocket to the devtools address
    let addr = await this.address(this.launchTimeout);
    this.ws = new WebSocket(addr, { perMessageDeflate: false });

    // wait until the websocket has connected before continuing
    await new Promise(resolve => this.ws.once('open', resolve));
    this.ws.on('message', data => this._handleMessage(data));

    // close any initial pages that automatically opened
    await this.send('Target.getTargets').then(({ targetInfos }) => {
      /* istanbul ignore next: this doesn't happen in every environment */
      return Promise.all(targetInfos.reduce((promises, target) => {
        return target.type !== 'page' ? promises : promises.concat(
          this.send('Target.closeTarget', { targetId: target.targetId })
        );
      }, []));
    });
  }

  isConnected() {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  async close() {
    if (this.closed) return;
    this.closed = true;

    // reject any pending callbacks
    for (let callback of this.#callbacks.values()) {
      callback.reject(Object.assign(callback.error, {
        message: `Protocol error (${callback.method}): Browser closed.`
      }));
    }

    // trigger rejecting pending page callbacks
    for (let page of this.pages.values()) {
      page._handleClose();
    }

    // clear callback and page references
    this.#callbacks.clear();
    this.pages.clear();

    // resolves when the browser has closed
    let closed = new Promise(resolve => {
      /* istanbul ignore next: race condition paranoia */
      if (!this.process || this.process.exitCode) resolve();
      else this.process.on('exit', resolve);
    });

    // force close if needed and able to
    let kill = () => {
      /* istanbul ignore next:
       *   difficult to test failure here without mocking private properties */
      if (this.process?.pid && !this.process.killed) {
        try { this.process.kill('SIGKILL'); } catch (error) {
          throw new Error(`Unable to close the browser: ${error.stack}`);
        }
      }
    };

    /* istanbul ignore else:
     *   difficult to test failure here without mocking private properties */
    if (this.profile) kill();
    else this.send('Browser.close').catch(() => kill());

    // after closing, attempt to clean up the profile directory
    await closed.then(() => new Promise(resolve => {
      // needed due to a bug in Node 12 - https://github.com/nodejs/node/issues/27097
      this.process?.stdin.end();
      this.process?.stdout.end();
      this.process?.stderr.end();

      /* istanbul ignore else: sanity */
      if (this.profile) {
        rimraf(this.profile, error => {
          /* istanbul ignore next:
           *   this might happen on some systems but ultimately it is a temp file */
          if (error) {
            this.log.debug('Could not clean up temporary browser profile directory.');
            this.log.debug(error);
          }

          resolve();
        });
      } else {
        resolve();
      }
    }));
  }

  async page(options) {
    // create and attach to a new page target returning the resulting page instance
    let { targetId } = await this.send('Target.createTarget', { url: 'about:blank' });
    let { sessionId } = await this.send('Target.attachToTarget', { targetId, flatten: true });
    return this.pages.get(sessionId).init(options);
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
      // send the message and return a promise that resolves or rejects for a matching response
      this.ws.send(JSON.stringify({ id, method, params }));
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
      // create a new page reference when attached to a target
      this.pages.set(data.params.sessionId, new Page(this, data));
    } else if (data.method === 'Target.detachedFromTarget') {
      // remove the old page reference when detached from a target
      let page = this.pages.get(data.params.sessionId);
      this.pages.delete(data.params.sessionId);
      page?._handleClose();
    }

    if (data.sessionId) {
      // message was for a specific page that sent it
      let page = this.pages.get(data.sessionId);
      page?._handleMessage(data);
    } else if (data.id && this.#callbacks.has(data.id)) {
      // resolve or reject a pending promise created with #send()
      let callback = this.#callbacks.get(data.id);
      this.#callbacks.delete(data.id);

      /* istanbul ignore next:
       *   currently does not happen during asset discovery but it's here just in case */
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
