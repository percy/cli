import log from '@percy/logger';
import Queue from './queue';
import Browser from './browser';
import assert from './utils/assert';
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
  async page({
    cacheDisabled = false,
    requestHeaders = {},
    ignoreHTTPSErrors = true,
    enableJavaScript = true,
    deviceScaleFactor = 1,
    mobile = false,
    height = 1024,
    width = 1280
  }) {
    let page = await this.#browser.page();

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
        page = await this.page({
          cacheDisabled: true,
          enableJavaScript,
          requestHeaders,
          width
        });

        // set up request interception
        page.network.onrequest = this._handleRequest({ meta, rootUrl, rootDom });
        page.network.onrequestfinished = this._handleRequestFinished({ meta, rootUrl, onDiscovery });
        page.network.onrequestfailed = this._handleRequestFailed({ meta });
        await page.network.intercept();

        // navigate to the root URL
        await page.send('Page.navigate', { url: rootUrl });

        // wait for the network to idle
        await page.network.idle(this.networkIdleTimeout);
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
