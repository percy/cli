import log from '@percy/logger';
import Queue from './queue';
import Browser from './browser';
import assert from './utils/assert';
import idle from './utils/idle';
import { createLocalResource } from './utils/resources';
import { hostname, normalizeURL, domainMatch } from './utils/url';

const ALLOWED_STATUSES = [200, 201, 301, 302, 304, 307, 308];

// A PercyDiscoverer instance connects to a browser process and concurrently discovers resources
// for snapshots. Resources are only captured from the snapshot's root URL by default unless
// additional allowed hostnames are defined. Captured resources are cached so future requests
// resolve much quicker and snapshots can share cached resources.
export default class PercyDiscoverer {
  #queue = null
  #browser = null
  #cache = new Map()

  constructor({
    // asset discovery concurrency
    concurrency,
    // additional allowed hostnames besides the root URL hostname
    allowedHostnames,
    // how long to wait before the network is considered to be idle and assets
    // are determined to be fully discovered
    networkIdleTimeout,
    // disable resource caching, the cache is still used but overwritten for each resource
    disableCache,
    // browser launch options
    launchOptions
  }) {
    this.#queue = new Queue(concurrency);
    this.#browser = new Browser();

    Object.assign(this, {
      allowedHostnames,
      networkIdleTimeout,
      disableCache,
      launchOptions
    });
  }

  // Installs the browser executable if necessary then launches and connects to a browser process.
  async launch() {
    await this.#browser.launch(this.launchOptions);
  }

  // Returns true or false when the browser is connected.
  isConnected() {
    return this.#browser.isConnected();
  }

  // Clears any unstarted discovery tasks and closes the browser.
  async close() {
    this.#queue.clear();
    await this.#browser.close();
  }

  // Returns a new browser page.
  async page() {
    return this.#browser.page();
  }

  // Gathers resources for a root URL and DOM. The `onDiscovery` callback will be called whenever an
  // asset is requested. The returned promise resolves when asset discovery finishes.
  gatherResources({
    onDiscovery,
    rootUrl,
    rootDom,
    enableJavaScript,
    requestHeaders,
    credentials,
    width,
    meta
  }) {
    assert(this.isConnected(), 'Browser not connected');

    // discover assets concurrently
    return this.#queue.push(async () => {
      log.debug(`Discovering resources @${width}px for ${rootUrl}`, { ...meta, url: rootUrl });
      let page;

      try {
        // get a fresh page
        page = await this.page();

        // set page options
        await Promise.all([
          page.send('Network.setCacheDisabled', { cacheDisabled: true }),
          page.send('Network.setExtraHTTPHeaders', { headers: requestHeaders }),
          page.send('Security.setIgnoreCertificateErrors', { ignore: true }),
          page.send('Emulation.setScriptExecutionDisabled', { value: !enableJavaScript }),
          page.send('Emulation.setDeviceMetricsOverride', {
            deviceScaleFactor: 1,
            mobile: false,
            height: 0,
            width
          })
        ]);

        // set up request interception
        let interceptor = new Interceptor(page, { credentials });
        interceptor.onrequest = this._handleRequest({ meta, rootUrl, rootDom });
        interceptor.onrequestfinished = this._handleRequestFinished({ meta, rootUrl, onDiscovery });
        interceptor.onrequestfailed = this._handleRequestFailed({ meta });
        await interceptor.enable();

        // navigate to the root URL
        await page.send('Page.navigate', { url: rootUrl });

        // wait for the network to idle
        await interceptor.idle(this.networkIdleTimeout);
      } finally {
        // safely close the page
        await page?.close();
      }
    });
  }

  // Creates a request handler for the specific root URL and DOM. The handler will serve the root
  // DOM for the root URL, respond with possible cached responses, skip resources that should not be
  // captured, and abort requests that result in an error.
  _handleRequest({ meta, rootUrl, rootDom }) {
    return async request => {
      let url = request.url;
      meta = { ...meta, url };
      log.debug(`Handling request for ${url}`, meta);

      try {
        if (url === rootUrl) {
          // root resource
          log.debug(`Serving root resource for ${url}`, meta);
          await request.respond({ status: 200, body: rootDom, headers: { 'content-type': 'text/html' } });
        } else if (!this.disableCache && this.#cache.has(url)) {
          // respond with cached response
          log.debug(`Response cache hit for ${url}`, meta);
          await request.respond(this.#cache.get(url).response);
        } else {
          // do not resolve resources that should not be captured
          let allowedHostnames = [hostname(rootUrl)].concat(this.allowedHostnames);
          assert(allowedHostnames.some(h => domainMatch(h, url)), 'is remote', meta);
          await request.continue();
        }
      } catch (error) {
        if (error.name === 'PercyAssertionError') {
          log.debug(`Skipping - ${error.toString()}`, error.meta);
          await request.abort();
        } else {
          log.error(`Encountered an error for ${url}`, meta);
          log.error(error);
          await request.abort(error);
        }
      }
    };
  }

  // Creates a request finished handler for a specific root URL to discover resolved resources. Both
  // the response and resource are cached for future snapshots and requests.
  _handleRequestFinished({ meta, rootUrl, onDiscovery }) {
    return async request => {
      let origin = request.redirectChain[0] || request;
      let url = normalizeURL(origin.url);
      meta = { ...meta, url };

      // do nothing for the root URL
      if (url === rootUrl) return;

      try {
        // process and cache the response and resource
        if (this.disableCache || !this.#cache.has(url)) {
          log.debug(`Processing resource - ${url}`, meta);

          // get and validate response
          let response = request.response;
          assert(response, 'no response', meta);

          // get and validate status
          let status = response.status;
          assert(ALLOWED_STATUSES.includes(status), 'disallowed status', { ...meta, status });

          // 'Network.responseReceived' returns multiple headers joined by newlines, however
          // `Fetch.fulfillRequest` (used for cached responses) will hang if there are newlines in
          // headers. The following reduction normalizes header values as arrays split on newlines
          let headers = Object.entries(response.headers).reduce((norm, [key, value]) => {
            return Object.assign(norm, { [key]: value.split('\n') });
          }, {});

          // get and validate body
          let body = await response.buffer();
          assert(body.toString(), 'is empty', meta);

          // create a local resource and log its info
          let resource = createLocalResource(url, body, response.mimeType, () => {
            log.debug(`Making local copy of response - ${url}`, meta);
          });

          log.debug(`-> url: ${url}`, meta);
          log.debug(`-> sha: ${resource.sha}`, meta);
          log.debug(`-> filepath: ${resource.filepath}`, meta);
          log.debug(`-> mimetype: ${resource.mimetype}`, meta);

          // cache both the response and resource
          response = { status, headers, body };
          this.#cache.set(url, { response, resource });
        }

        // call `onDiscovery` with the resource
        onDiscovery(this.#cache.get(url).resource);
      } catch (error) {
        if (error.name === 'PercyAssertionError') {
          log.debug(`Skipping - ${error.toString()}`, error.meta);
        } else {
          log.error(`Encountered an error for ${url}`, meta);
          log.error(error);
        }
      }
    };
  }

  // Creates a failed request handler that logs non-generic failure reasons.
  _handleRequestFailed({ meta }) {
    return request => {
      let { url, error } = request;

      // do not log generic failures since the real error was most likely
      // already logged from elsewhere
      if (error !== 'net::ERR_FAILED') {
        log.debug(`Request failed for ${url} - ${error}`, { ...meta, url });
      }
    };
  }
}

// The Interceptor class creates common handlers for dealing with intercepting asset requests
// for a given page using various devtools protocol events and commands.
class Interceptor {
  #pending = new Map();
  #requests = new Map();
  #intercepts = new Map();
  #authentications = new Set();

  constructor(page, { credentials }) {
    this.page = page;
    this.credentials = credentials;
  }

  async enable() {
    // add and configure request listeners for intercepting
    this.page.on('Fetch.authRequired', this._handleAuthRequired);
    this.page.on('Fetch.requestPaused', this._handleRequestPaused);
    this.page.on('Network.requestWillBeSent', this._handleRequestWillBeSent);
    this.page.on('Network.responseReceived', this._handleResponseReceived);
    this.page.on('Network.loadingFinished', this._handleLoadingFinished);
    this.page.on('Network.loadingFailed', this._handleLoadingFailed);

    // enable request interception
    await Promise.all([
      this.page.send('Network.enable'),
      this.page.send('Fetch.enable', {
        handleAuthRequests: true,
        patterns: [{ urlPattern: '*' }]
      })
    ]);
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
      } else {
        this.#pending.set(requestId, event);
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

    await this.onrequestfinished(request);

    this.#requests.delete(requestId);
    this.#authentications.delete(request.interceptId);
  }

  // Called when a request has failed loading and triggers the this.onrequestfailed callback.
  _handleLoadingFailed = async event => {
    let { requestId, errorText } = event;
    let request = this.#requests.get(requestId);
    if (!request) return;

    request.error = errorText;
    await this.onrequestfailed(request);

    this.#requests.delete(requestId);
    this.#authentications.delete(request.interceptId);
  }
}
