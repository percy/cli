import fetch from 'node-fetch';
import puppeteer from 'puppeteer-core';
import log from '@percy/logger';
import Queue from './queue';
import assert from './utils/assert';
import idle from './utils/idle';
import maybeInstallBrowser from './utils/install-browser';
import { createLocalResource } from './utils/resources';
import { hostname, normalizeURL, domainMatch } from './utils/url';

const REDIRECT_STATUSES = [301, 302, 304, 307, 308];
const ALLOWED_STATUSES = [200, 201, ...REDIRECT_STATUSES];

// A PercyDiscoverer instance connects to a puppeteer browser and concurrently
// discovers resources for snapshots. Resources are only captured from the
// snapshot's root URL by default unless additional allowed hostnames are
// defined. Captured resources are cached so future requests resolve much
// quicker and snapshots can share cached resources.
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
    disableAssetCache,
    // browser launch options
    launchOptions
  }) {
    this.#queue = new Queue(concurrency);

    Object.assign(this, {
      allowedHostnames,
      networkIdleTimeout,
      disableAssetCache,
      launchOptions
    });
  }

  // Returns true or false when the browser is connected.
  isConnected() {
    return !!this.#browser?.isConnected();
  }

  // Installs the browser executable if necessary and launches a Puppeteer
  // browser instance for use during asset discovery.
  async launch() {
    let executablePath = await maybeInstallBrowser(this.launchOptions?.executablePath);

    this.#browser = await puppeteer.launch({
      ...this.launchOptions,
      ignoreHTTPSErrors: true,
      handleSIGINT: false,
      handleSIGTERM: false,
      handleSIGHUP: false,
      executablePath,
      args: [
        '--no-sandbox',
        '--disable-web-security',
        ...(this.launchOptions?.args || [])
      ]
    });
  }

  // Clears any unstarted discovery tasks and closes the browser.
  async close() {
    this.#queue.clear();
    await this.#browser?.close();
  }

  // Returns a new browser page.
  async page() {
    return this.#browser?.newPage();
  }

  // Gathers resources for a root URL and DOM. The accumulator should be a Map
  // and will be populated with resources by URL. Resolves when asset discovery
  // finishes, although shouldn't be awaited on as discovery happens concurrently.
  gatherResources(accumulator, {
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
      log.debug(`Discovering resources @${width}px for ${rootUrl}`, { url: rootUrl, ...meta });

      // get a fresh page
      let page = await this.page();
      // track processing network requests
      let processing = 0;

      // set page options
      await page.setRequestInterception(true);
      await page.setJavaScriptEnabled(enableJavaScript);
      await page.setViewport({ ...page.viewport(), width });
      await page.setExtraHTTPHeaders(requestHeaders);

      // add and configure request listeners
      page
        .on('request', this._handleRequest({
          onRequest: () => processing++,
          rootUrl,
          rootDom,
          meta
        }))
        .on('requestfinished', this._handleRequestFinished({
          onFinished: () => processing--,
          accumulator,
          rootUrl,
          meta
        }))
        .on('requestfailed', this._handleRequestFailed({
          onFailed: () => processing--,
          meta
        }));

      // navigate to the root URL and wait for the network to idle
      await page.goto(rootUrl);
      await idle(() => processing, this.networkIdleTimeout);

      // cleanup
      page.removeAllListeners('request');
      page.removeAllListeners('requestfailed');
      page.removeAllListeners('requestfinished');
      await page.close();
    });
  }

  // Creates a request handler for the specific root URL and DOM. The handler
  // will serve the root DOM for the root URL, respond with possible cached
  // responses, skip resources that should not be captured, and abort requests
  // that result in an error.
  _handleRequest({ rootUrl, rootDom, onRequest, meta }) {
    let allowedHostnames = [hostname(rootUrl)].concat(this.allowedHostnames);

    return request => {
      let url = request.url();

      meta = { ...meta, url };
      log.debug(`Handling request for ${url}`, meta);
      onRequest();

      try {
        if (url === rootUrl) {
          // root resource
          log.debug(`Serving root resource for ${url}`, meta);
          request.respond({ status: 200, body: rootDom, contentType: 'text/html' });
        } else if (!this.disableAssetCache && this.#cache.has(url)) {
          // respond with cached response
          log.debug(`Response cache hit for ${url}`, meta);
          request.respond(this.#cache.get(url).response);
        } else {
          // do not resolve resources that should not be captured
          assert(allowedHostnames.some(h => domainMatch(h, url)), 'is remote', meta);
          // continue the request
          request.continue();
        }
      } catch (error) {
        if (error.name === 'PercyAssertionError') {
          log.debug(`Skipping - ${error.toString()}`, error.meta);
        } else {
          log.error(`Encountered an error for ${url}`, meta);
          log.error(error);
        }

        // request hangs without aborting on error
        request.abort();
      }
    };
  }

  // Creates a request finished handler for a specific root URL that will add
  // resolved resources to an accumulator. Both the response and resource are
  // cached for future snapshots and requests.
  _handleRequestFinished({ rootUrl, accumulator, onFinished, meta }) {
    return async request => {
      let url = normalizeURL(request.url());
      meta = { ...meta, url };

      try {
        // do nothing for the root URL or URLs that start with `data:` since
        // Puppeteer network interception doesn't support proper request
        // aborting for those URLs
        if (url === rootUrl || url.startsWith('data:')) return;

        // process and cache the response and resource
        if (this.disableAssetCache || !this.#cache.has(url)) {
          log.debug(`Processing resource - ${url}`, meta);
          let response = await this._parseRequestResponse(url, request, meta);

          let mimetype = response.headers['content-type'][0].split(';')[0];
          let resource = createLocalResource(url, response.body, mimetype, () => {
            log.debug(`Making local copy of response - ${url}`, meta);
          });

          log.debug(`-> url: ${url}`, meta);
          log.debug(`-> sha: ${resource.sha}`, meta);
          log.debug(`-> filepath: ${resource.filepath}`, meta);
          log.debug(`-> mimetype: ${resource.mimetype}`, meta);

          this.#cache.set(url, { response, resource });
        }

        // add the resource to the accumulator
        accumulator.set(url, this.#cache.get(url).resource);
      } catch (error) {
        if (error.name === 'PercyAssertionError') {
          log.debug(`Skipping - ${error.toString()}`, error.meta);
        } else {
          log.error(`Encountered an error for ${url}`, meta);
          log.error(error);
        }
      } finally {
        onFinished();
      }
    };
  }

  // Creates a failed request handler that logs non-generic failure reasons.
  _handleRequestFailed({ onFailed, meta }) {
    return req => {
      let error = req.failure().errorText;

      // do not log generic failures since the real error was most likely
      // already logged from elsewhere
      if (error !== 'net::ERR_FAILED') {
        log.debug(`Request failed for ${req.url()} - ${error}`, meta);
      }

      onFailed();
    };
  }

  // Parses a request's response to find the status, headers, and body. Performs
  // various response assertions and follows redirect requests using node-fetch.
  async _parseRequestResponse(url, request, meta) {
    let headers, body;

    let response = request.response();
    assert(response, 'no response', meta);

    let status = response.status();
    assert(ALLOWED_STATUSES.includes(status), 'disallowed status', { status, ...meta });

    if (REDIRECT_STATUSES.includes(status)) {
      // fetch's default max redirect length is 20
      let length = request.redirectChain().length;
      assert(length <= 20, 'too many redirects', { length, ...meta });

      let redirect = await fetch(response.url(), {
        responseType: 'arraybuffer',
        headers: request.headers()
      });

      headers = redirect.headers.raw();
      body = await redirect.buffer();
    } else {
      // CDP returns multiple headers joined by newlines, however
      // `request.respond` (used for cached responses) will hang if there are
      // newlines in headers. The following reduction normalizes header values
      // as arrays split on newlines
      headers = Object.entries(response.headers())
        .reduce((norm, [key, value]) => (
          Object.assign(norm, { [key]: value.split('\n') })
        ), {});

      body = await response.buffer();
    }

    assert(body.toString(), 'is empty', meta);
    return { status, headers, body };
  }
}
