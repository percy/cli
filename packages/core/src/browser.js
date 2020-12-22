import os from 'os';
import path from 'path';
import {
  promises as fs,
  existsSync
} from 'fs';
import { spawn } from 'child_process';
import EventEmitter from 'events';
import WebSocket from 'ws';
import log from '@percy/logger';
import assert from './utils/assert';
import install from './utils/install-browser';
import idle from './utils/idle';

const { assign } = Object;

// watches the browser process's stderr and resolves when it emits the devtools protocol address or
// rejects if the process exits for any reason or if the address does not appear after the timeout
function getDevToolsAddress(proc, timeout) {
  return new Promise((resolve, reject) => {
    let stderr = '';

    let handleData = chunk => {
      stderr += (chunk = chunk.toString());
      let match = chunk.match(/^DevTools listening on (ws:\/\/.*)$/m);
      if (match) cleanup(() => resolve(match[1]));
    };

    let handleExit = () => handleError();
    let handleClose = () => handleError();
    let handleError = error => {
      cleanup(() => reject(new Error([
        'Failed to launch browser.',
        (error ? ' ' + error.message : ''),
        '\n', stderr, '\n\n'
      ].join(''))));
    };

    let cleanup = callback => {
      clearTimeout(timeoutId);
      proc.stderr.off('data', handleData);
      proc.stderr.off('close', handleClose);
      proc.off('exit', handleExit);
      proc.off('error', handleError);
      callback();
    };

    let timeoutId = setTimeout(() => handleError(
      new Error(`Timed out after ${timeout}ms`)
    ), timeout);

    proc.stderr.on('data', handleData);
    proc.stderr.on('close', handleClose);
    proc.on('exit', handleExit);
    proc.on('error', handleError);
  });
}

export default class Browser extends EventEmitter {
  #pages = new Map();
  #callbacks = new Map();
  #closed = false;
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

  async launch({
    executable,
    headless = true,
    args: uargs = [],
    timeout = 30000
  } = {}) {
    if (this.isConnected()) return;

    // check if any provided executable exists
    if (executable && !existsSync(executable)) {
      log.error(`Browser executable not found: ${executable}`);
      executable = null;
    }

    // download and install the browser if not already present
    this.executable = executable || await install();
    // create a temporary profile directory
    this.profile = await fs.mkdtemp(path.join(os.tmpdir(), 'percy-browser-'));

    // collect args to pass to the browser process
    let args = [...this.defaultArgs, `--user-data-dir=${this.profile}`];
    if (headless) args.push('--headless', '--hide-scrollbars', '--mute-audio');
    for (let a of uargs) if (!args.includes(a)) args.push(a);

    // spawn the browser process detached in its own group and session
    this.process = spawn(this.executable, args, { detached: true });
    // wait until the browser outputs its devtools address
    this.address = await getDevToolsAddress(this.process, timeout);
    // connect a websocket to the debug address
    this.ws = new WebSocket(this.address, { perMessageDeflate: false });

    // wait until the websocket has connected before continuing
    await new Promise(resolve => this.ws.once('open', resolve));
    this.ws.on('message', data => this._handleMessage(data));

    // close the initial page that automatically opened
    await this.send('Target.getTargets').then(({ targetInfos }) => {
      let { targetId } = targetInfos.find(t => t.type === 'page');
      return this.send('Target.closeTarget', { targetId });
    });
  }

  isConnected() {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  async close() {
    if (!this.isConnected() || this.#closed) return;
    this.#closed = true;

    // reject any pending callbacks
    for (let callback of this.#callbacks.values()) {
      callback.reject(assign(callback.error, {
        message: `Protocol error (${callback.method}): Browser closed.`
      }));
    }

    // trigger rejecting pending page callbacks
    for (let page of this.#pages.values()) {
      page._handleClose();
    }

    // clear callback and page references
    this.#callbacks.clear();
    this.#pages.clear();

    // attempt to close the browser gracefully
    let closed = new Promise(resolve => {
      this.process.on('exit', resolve);
    });

    await this.send('Browser.close').catch(() => {
      // force close if needed and able to
      if (this.process?.pid && !this.process.killed) {
        try { this.process.kill('SIGKILL'); } catch (error) {
          throw new Error(`Unable to close the browser: ${error.stack}`);
        }
      }
    });

    await closed;

    // clean up the profile directory
    await fs.rmdir(this.profile, { recursive: true });
  }

  async page() {
    // create and attach to a new page target returning the resulting page instance
    let { targetId } = await this.send('Target.createTarget', { url: 'about:blank' });
    let { sessionId } = await this.send('Target.attachToTarget', { targetId, flatten: true });
    return this.#pages.get(sessionId);
  }

  send(method, params) {
    assert(this.isConnected(), 'Browser not connected');

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

  _handleMessage(data) {
    data = JSON.parse(data);

    if (data.method === 'Target.attachedToTarget') {
      // create a new page reference when attached to a target
      this.#pages.set(data.params.sessionId, new Page(this, data));
    } else if (data.method === 'Target.detachedFromTarget') {
      // remove the old page reference when detached from a target
      let page = this.#pages.get(data.params.sessionId);
      this.#pages.delete(data.params.sessionId);
      page?._handleClose();
    }

    if (data.sessionId) {
      // message was for a specific page that sent it
      let page = this.#pages.get(data.sessionId);
      page?._handleMessage(data);
    } else if (data.id && this.#callbacks.has(data.id)) {
      // resolve or reject a pending promise created with #send()
      let callback = this.#callbacks.get(data.id);
      this.#callbacks.delete(data.id);

      if (data.error) {
        callback.reject(assign(callback.error, {
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
}

export class Page extends EventEmitter {
  #callbacks = new Map();
  #browser = null;

  constructor(browser, { params }) {
    super();
    this.#browser = browser;
    this.sessionId = params.sessionId;
    this.targetId = params.targetInfo.targetId;
    this.network = new Network(this);

    this.send('Page.getFrameTree').then(({ frameTree }) => {
      this.frameId = frameTree.frame.id;
    });

    this
      .on('Runtime.executionContextCreated', ({ context }) => {
        if (this.frameId === context.auxData.frameId) {
          this.executionContextId = context.id;
        }
      })
      .on('Runtime.executionContextDestroyed', ({ executionContextId }) => {
        if (this.executionContextId === executionContextId) {
          delete this.executionContextId;
        }
      })
      .on('Runtime.executionContextsCleared', () => {
        delete this.executionContextId;
      })
      .send('Runtime.enable');
  }

  async close() {
    // close the target page if not already closed
    if (!this.#browser) throw new Error('Page already closed.');
    await this.#browser.send('Target.closeTarget', { targetId: this.targetId });
  }

  async eval(fn, args = []) {
    let { result, exceptionDetails } = await this.send('Runtime.callFunctionOn', {
      functionDeclaration: fn.toString(),
      arguments: args.map(value => ({ value })),
      executionContextId: this.executionContextId,
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
    if (!this.#browser) {
      throw new Error(`Protocol error (${method}): Page closed.`);
    }

    // send a raw message to the browser so we can provide a sessionId
    let id = this.#browser.send({ sessionId: this.sessionId, method, params });

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
        callback.reject(assign(callback.error, {
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
      callback.reject(assign(callback.error, {
        message: `Protocol error (${callback.method}): Page closed.`
      }));
    }

    // clear callbacks and browser references
    this.#callbacks.clear();
    this.#browser = null;
  }
}

// The Interceptor class creates common handlers for dealing with intercepting asset requests
// for a given page using various devtools protocol events and commands.
class Network {
  #pending = new Map();
  #requests = new Map();
  #intercepts = new Map();
  #authentications = new Set();

  constructor(page) {
    this.page = page;
    this.page.on('Fetch.authRequired', this._handleAuthRequired);
    this.page.on('Fetch.requestPaused', this._handleRequestPaused);
    this.page.on('Network.requestWillBeSent', this._handleRequestWillBeSent);
    this.page.on('Network.responseReceived', this._handleResponseReceived);
    this.page.on('Network.loadingFinished', this._handleLoadingFinished);
    this.page.on('Network.loadingFailed', this._handleLoadingFailed);
    this.page.send('Network.enable');
  }

  async intercept() {
    this._intercept = true;

    // enable request interception
    await this.page.send('Fetch.enable', {
      handleAuthRequests: true,
      patterns: [{ urlPattern: '*' }]
    });
  }

  // Resolves after the timeout when there are no more in-flight requests.
  async idle(timeout) {
    await idle(() => this.#requests.size, timeout);
  }

  // Called when a request requires authentication. Responds to the auth request with any provided
  // authentication credentials.
  _handleAuthRequired = async event => {
    let { requestId } = event;
    let { username, password } = this.credentials || {};
    let response = 'Default';

    if (this.#authentications.has(requestId)) {
      response = 'CancelAuth';
    } else if (username || password) {
      response = 'ProvideCredentials';
      this.#authentications.add(requestId);
    }

    await this.page.send('Fetch.continueWithAuth', {
      requestId: event.requestId,
      authChallengeResponse: { response, username, password }
    });
  }

  // Called when a request is made. The request is paused until it is fulfilled, continued, or
  // aborted. If the request is already pending, handle it; otherwise set it to be intercepted.
  _handleRequestPaused = event => {
    let { networkId, requestId } = event;

    if (this.#pending.has(networkId)) {
      let pending = this.#pending.get(networkId);
      this._handleRequest(pending, requestId);
      this.#pending.delete(networkId);
    } else {
      this.#intercepts.set(networkId, requestId);
    }
  }

  // Called when a request will be sent. If the request has already been intercepted, handle it;
  // otherwise set it to be pending until it is paused.
  _handleRequestWillBeSent = event => {
    let { requestId, request } = event;

    // do not handle data urls
    if (!request.url.startsWith('data:')) {
      if (this.#intercepts.has(requestId)) {
        let interceptId = this.#intercepts.get(requestId);
        this._handleRequest(event, interceptId);
        this.#intercepts.delete(requestId);
      } else if (this._intercept) {
        this.#pending.set(requestId, event);
      } else {
        this._handleRequest(event);
      }
    }
  }

  // Called when a pending request is paused. Handles associating redirected requests with
  // responses and calls this.onrequest with request info and callbacks to continue, respond,
  // or abort a request. One of the callbacks is required to be called and only one.
  _handleRequest = async (event, interceptId) => {
    let { requestId, request } = event;
    let redirectChain = [];

    // if handling a redirected request, associate the response and add to its redirect chain
    if (event.redirectResponse && this.#requests.has(requestId)) {
      let req = this.#requests.get(requestId);
      req.response = event.redirectResponse;
      redirectChain = [...req.redirectChain, req];
      // clean up auth redirects
      this.#authentications.delete(interceptId);
    }

    request.interceptId = interceptId;
    request.redirectChain = redirectChain;
    this.#requests.set(requestId, request);

    if (this._intercept) {
      await this.onrequest({
        ...request,
        // call to continue the request as-is
        continue: () => this.page.send('Fetch.continueRequest', {
          requestId: interceptId
        }),
        // call to respond with a specific status, body, and headers
        respond: payload => this.page.send('Fetch.fulfillRequest', {
          requestId: interceptId,
          responseCode: payload.status || 200,
          body: payload.body && Buffer.from(payload.body).toString('base64'),
          responseHeaders: Object.entries(payload.headers).map(([name, value]) => {
            return { name: name.toLowerCase(), value: String(value) };
          })
        }),
        // call to fail or abort the request
        abort: error => this.page.send('Fetch.failRequest', {
          requestId: interceptId,
          errorReason: error ? 'Failed' : 'Aborted'
        })
      });
    }
  }

  // Called when a response has been received for a specific request. Associates the response with
  // the request data and adds a buffer method to fetch the response body when needed.
  _handleResponseReceived = event => {
    let { requestId, response } = event;
    let request = this.#requests.get(requestId);
    if (!request) return;

    request.response = response;
    request.response.buffer = async () => {
      let { body, base64Encoded } = await this.page.send('Network.getResponseBody', { requestId });
      return Buffer.from(body, base64Encoded ? 'base64' : 'utf8');
    };
  }

  // Called when a request has finished loading which triggers the this.onrequestfinished
  // callback. The request should have an associated response and be finished with any redirects.
  _handleLoadingFinished = async event => {
    let { requestId } = event;
    let request = this.#requests.get(requestId);
    if (!request) return;

    if (this._intercept) {
      await this.onrequestfinished(request);
    }

    this.#requests.delete(requestId);
    this.#authentications.delete(request.interceptId);
  }

  // Called when a request has failed loading and triggers the this.onrequestfailed callback.
  _handleLoadingFailed = async event => {
    let { requestId, errorText } = event;
    let request = this.#requests.get(requestId);
    if (!request) return;

    if (this._intercept) {
      request.error = errorText;
      await this.onrequestfailed(request);
    }

    this.#requests.delete(requestId);
    this.#authentications.delete(request.interceptId);
  }
}
