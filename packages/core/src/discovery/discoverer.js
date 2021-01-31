import logger from '@percy/logger';
import Queue from '../queue';
import assert from '../utils/assert';
import { createLocalResource } from '../utils/resources';
import { hostname, normalizeURL, domainMatch } from '../utils/url';
import Browser from './browser';

const ALLOWED_STATUSES = [200, 201, 301, 302, 304, 307, 308];

// A PercyDiscoverer instance connects to a browser process and concurrently discovers resources
// for snapshots. Resources are only captured from the snapshot's root URL by default unless
// additional allowed hostnames are defined. Captured resources are cached so future requests
// resolve much quicker and snapshots can share cached resources.
export default class PercyDiscoverer {
  queue = null;
  browser = null;
  log = logger('core:discovery');

  #cache = new Map();

  constructor({
    // asset discovery concurrency
    concurrency = 5,
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
    this.queue = new Queue(concurrency);
    this.browser = new Browser();

    Object.assign(this, {
      allowedHostnames,
      networkIdleTimeout,
      disableCache,
      launchOptions
    });
  }

  // Installs the browser executable if necessary then launches and connects to a browser process.
  async launch() {
    await this.browser.launch(this.launchOptions);
  }

  // Returns true or false when the browser is connected.
  isConnected() {
    return this.browser.isConnected();
  }

  // Clears any unstarted discovery tasks and closes the browser.
  async close() {
    this.queue.clear();
    await this.browser.close();
  }

  // Returns a new browser page.
  async page({
    cacheDisabled = false,
    requestHeaders = {},
    authorization = {},
    ignoreHTTPSErrors = true,
    enableJavaScript = true,
    deviceScaleFactor = 1,
    mobile = false,
    height = 1024,
    width = 1280,
    meta
  }) {
    let page = await this.browser.page({ meta });
    page.network.timeout = this.networkIdleTimeout;
    page.network.authorization = authorization;

    // set page options
    await Promise.all([
      page.send('Network.setCacheDisabled', { cacheDisabled }),
      page.send('Network.setExtraHTTPHeaders', { headers: requestHeaders }),
      page.send('Security.setIgnoreCertificateErrors', { ignore: ignoreHTTPSErrors }),
      page.send('Emulation.setScriptExecutionDisabled', { value: !enableJavaScript }),
      page.send('Emulation.setDeviceMetricsOverride', { deviceScaleFactor, mobile, height, width })
    ]);

    return page;
  }

  // Gathers resources for a root URL and DOM. The `onDiscovery` callback will be called whenever an
  // asset is requested. The returned promise resolves when asset discovery finishes.
  gatherResources({
    onDiscovery,
    rootUrl,
    rootDom,
    enableJavaScript,
    requestHeaders,
    authorization,
    width,
    meta
  }) {
    assert(this.isConnected(), 'Browser not connected');

    // discover assets concurrently
    return this.queue.push(async () => {
      this.log.debug(`Discovering resources @${width}px for ${rootUrl}`, { ...meta, url: rootUrl });
      let page;

      try {
        // get a fresh page
        page = await this.page({
          cacheDisabled: true,
          enableJavaScript,
          requestHeaders,
          authorization,
          width,
          meta
        });

        // set up request interception
        page.network.onrequest = this._handleRequest({ meta, rootUrl, rootDom });
        page.network.onrequestfinished = this._handleRequestFinished({ meta, rootUrl, onDiscovery });
        page.network.onrequestfailed = this._handleRequestFailed({ meta });
        await page.network.intercept();

        // navigate to the root URL and wait for the network to idle
        await page.goto(rootUrl);
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
    let allowedHostnames = [hostname(rootUrl)].concat(this.allowedHostnames);

    return async request => {
      let url = request.url;
      meta = { ...meta, url };

      this.log.debug(`Handling request for ${url}`, meta);

      try {
        if (url === rootUrl) {
          // root resource
          this.log.debug(`Serving root resource for ${url}`, meta);
          await request.respond({ status: 200, body: rootDom, headers: { 'content-type': 'text/html' } });
        } else if (!this.disableCache && this.#cache.has(url)) {
          // respond with cached response
          this.log.debug(`Response cache hit for ${url}`, meta);
          await request.respond(this.#cache.get(url).response);
        } else {
          // do not resolve resources that should not be captured
          assert(allowedHostnames.some(h => domainMatch(h, url)), 'is remote', meta);
          await request.continue();
        }
      } catch (error) {
        if (error.name === 'PercyAssertionError') {
          this.log.debug(`Skipping - ${error.toString()}`, error.meta);
          await request.abort();
        } else {
          this.log.debug(`Encountered an error handling request: ${url}`, meta);
          this.log.debug(error);
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
          this.log.debug(`Processing resource - ${url}`, meta);

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
            this.log.debug(`Making local copy of response - ${url}`, meta);
          });

          this.log.debug(`-> url: ${url}`, meta);
          this.log.debug(`-> sha: ${resource.sha}`, meta);
          this.log.debug(`-> filepath: ${resource.filepath}`, meta);
          this.log.debug(`-> mimetype: ${resource.mimetype}`, meta);

          // cache both the response and resource
          response = { status, headers, body };
          this.#cache.set(url, { response, resource });
        }

        // call `onDiscovery` with the resource
        onDiscovery(this.#cache.get(url).resource);
      } catch (error) {
        if (error.name === 'PercyAssertionError') {
          this.log.debug(`Skipping - ${error.toString()}`, error.meta);
        } else {
          this.log.debug(`Encountered an error processing resource: ${url}`, meta);
          this.log.debug(error);
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
        this.log.debug(`Request failed for ${url}: ${error}`, { ...meta, url });
      }
    };
  }
}
