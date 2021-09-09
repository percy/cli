import logger from '@percy/logger';
import { waitFor } from './utils';
import {
  createRequestHandler,
  createRequestFinishedHandler,
  createRequestFailedHandler
} from './discovery';

// The Interceptor class creates common handlers for dealing with intercepting asset requests
// for a given page using various devtools protocol events and commands.
export default class Network {
  static TIMEOUT = 30000;

  log = logger('core:network');

  #pending = new Map();
  #requests = new Map();
  #intercepts = new Map();
  #authentications = new Set();

  constructor(page, options) {
    this.page = page;
    this.timeout = options.networkIdleTimeout ?? 100;
    this.authorization = options.authorization;
    this.requestHeaders = options.requestHeaders ?? {};
    this.userAgent = options.userAgent ??
      // by default, emulate a non-headless browser
      page.session.browser.version.userAgent.replace('Headless', '');
    this.interceptEnabled = !!options.intercept;
    this.meta = page.meta;

    if (this.interceptEnabled) {
      this.onRequest = createRequestHandler(options.intercept, this.meta);
      this.onRequestFinished = createRequestFinishedHandler(options.intercept, this.meta);
      this.onRequestFailed = createRequestFailedHandler(options.intercept, this.meta);
    }
  }

  watch(session) {
    let bind = f => e => f(session, e);

    session.on('Network.requestWillBeSent', bind(this._handleRequestWillBeSent));
    session.on('Network.responseReceived', bind(this._handleResponseReceived));
    session.on('Network.eventSourceMessageReceived', this._handleEventSourceMessageReceived);
    session.on('Network.loadingFinished', this._handleLoadingFinished);
    session.on('Network.loadingFailed', this._handleLoadingFailed);

    let commands = [
      session.send('Network.enable'),
      session.send('Network.setBypassServiceWorker', { bypass: true }),
      session.send('Network.setCacheDisabled', { cacheDisabled: true }),
      session.send('Network.setUserAgentOverride', { userAgent: this.userAgent }),
      session.send('Network.setExtraHTTPHeaders', { headers: this.requestHeaders })
    ];

    if (this.interceptEnabled && session.isDocument) {
      session.on('Fetch.requestPaused', bind(this._handleRequestPaused));
      session.on('Fetch.authRequired', bind(this._handleAuthRequired));

      commands.push(session.send('Fetch.enable', {
        handleAuthRequests: true,
        patterns: [{ urlPattern: '*' }]
      }));
    }

    return Promise.all(commands);
  }

  // Resolves after the timeout when there are no more in-flight requests.
  async idle(filter = () => true, timeout = this.timeout) {
    let requests = [];

    this.log.debug(`Wait for ${timeout}ms idle`, this.meta);

    await waitFor(() => {
      if (this.page.session.closedReason) {
        throw new Error(`Network error: ${this.page.session.closedReason}`);
      }

      requests = Array.from(this.#requests.values()).filter(filter);
      return requests.length === 0;
    }, {
      timeout: Network.TIMEOUT,
      idle: timeout
    }).catch(error => {
      // throw a better timeout error
      if (error.message.startsWith('Timeout')) {
        let msg = 'Timed out waiting for network requests to idle.';

        if (this.log.shouldLog('debug')) {
          msg += `\n\n  ${['Active requests:',
            ...requests.map(r => r.url)
          ].join('\n  -> ')}\n`;
        }

        throw new Error(msg);
      } else {
        throw error;
      }
    });
  }

  // Called when a request should be removed from various trackers
  _forgetRequest({ requestId, interceptId }, keepPending) {
    this.#requests.delete(requestId);
    this.#authentications.delete(interceptId);

    if (!keepPending) {
      this.#pending.delete(requestId);
      this.#intercepts.delete(requestId);
    }
  }

  // Called when a request requires authentication. Responds to the auth request with any
  // provided authorization credentials.
  _handleAuthRequired = async (session, event) => {
    let { username, password } = this.authorization ?? {};
    let { requestId } = event;
    let response = 'Default';

    if (this.#authentications.has(requestId)) {
      response = 'CancelAuth';
    } else if (username || password) {
      response = 'ProvideCredentials';
      this.#authentications.add(requestId);
    }

    await session.send('Fetch.continueWithAuth', {
      requestId: event.requestId,
      authChallengeResponse: { response, username, password }
    });
  }

  // Called when a request is made. The request is paused until it is fulfilled, continued, or
  // aborted. If the request is already pending, handle it; otherwise set it to be intercepted.
  _handleRequestPaused = async (session, event) => {
    let { networkId: requestId } = event;
    let pending = this.#pending.get(requestId);
    this.#pending.delete(requestId);

    // guard against redirects with the same requestId
    if (pending?.request.url === event.request.url &&
        pending.request.method === event.request.method) {
      await this._handleRequest(session, pending, event.requestId);
    } else {
      this.#intercepts.set(requestId, event);
    }
  }

  // Called when a request will be sent. If the request has already been intercepted, handle it;
  // otherwise set it to be pending until it is paused.
  _handleRequestWillBeSent = async (session, event) => {
    let { requestId, request } = event;

    // do not handle data urls
    if (request.url.startsWith('data:')) return;

    if (this.interceptEnabled) {
      let intercept = this.#intercepts.get(requestId);
      this.#pending.set(requestId, event);

      if (intercept) {
        await this._handleRequest(session, event, intercept.requestId);
        this.#intercepts.delete(requestId);
      }
    } else {
      await this._handleRequest(session, event);
    }
  }

  // Called when a pending request is paused. Handles associating redirected requests with
  // responses and calls this.onrequest with request info and callbacks to continue, respond,
  // or abort a request. One of the callbacks is required to be called and only one.
  _handleRequest = async (session, event, interceptId) => {
    let { requestId, request } = event;
    let redirectChain = [];

    // if handling a redirected request, associate the response and add to its redirect chain
    if (event.redirectResponse && this.#requests.has(requestId)) {
      let req = this.#requests.get(requestId);
      redirectChain = [...req.redirectChain, req];
      // clean up interim requests
      this._forgetRequest(req, true);
    }

    request.requestId = requestId;
    request.interceptId = interceptId;
    request.redirectChain = redirectChain;
    this.#requests.set(requestId, request);

    await this.onRequest?.({
      ...request,

      // call to continue the request as-is
      continue: () => session.send('Fetch.continueRequest', {
        requestId: interceptId
      }),

      // call to respond with a specific status, content, and headers
      respond: ({ status, content, headers }) => session.send('Fetch.fulfillRequest', {
        requestId: interceptId,
        responseCode: status || 200,
        body: Buffer.from(content).toString('base64'),
        responseHeaders: Object.entries(headers || {}).map(([name, value]) => {
          return { name: name.toLowerCase(), value: String(value) };
        })
      }),

      // call to fail or abort the request
      abort: error => session.send('Fetch.failRequest', {
        requestId: interceptId,
        // istanbul note: this check used to be necessary and might be again in the future if we
        // ever need to abort a request due to reasons other than failures
        errorReason: error ? 'Failed' : /* istanbul ignore next */ 'Aborted'
      })
    });
  }

  // Called when a response has been received for a specific request. Associates the response with
  // the request data and adds a buffer method to fetch the response body when needed.
  _handleResponseReceived = (session, event) => {
    let { requestId, response } = event;
    let request = this.#requests.get(requestId);
    /* istanbul ignore if: race condition paranioa */
    if (!request) return;

    request.response = response;
    request.response.buffer = async () => {
      let result = await session.send('Network.getResponseBody', { requestId });
      return Buffer.from(result.body, result.base64Encoded ? 'base64' : 'utf8');
    };
  }

  // Called when a request streams events. These types of requests break asset discovery because
  // they never finish loading, so we untrack them to signal idle after the first event.
  _handleEventSourceMessageReceived = event => {
    let request = this.#requests.get(event.requestId);
    /* istanbul ignore else: race condition paranioa */
    if (request) this._forgetRequest(request);
  }

  // Called when a request has finished loading which triggers the this.onrequestfinished
  // callback. The request should have an associated response and be finished with any redirects.
  _handleLoadingFinished = async event => {
    let request = this.#requests.get(event.requestId);
    /* istanbul ignore if: race condition paranioa */
    if (!request) return;

    await this.onRequestFinished?.(request);
    this._forgetRequest(request);
  }

  // Called when a request has failed loading and triggers the this.onrequestfailed callback.
  _handleLoadingFailed = async event => {
    let request = this.#requests.get(event.requestId);
    /* istanbul ignore if: race condition paranioa */
    if (!request) return;

    request.error = event.errorText;
    await this.onRequestFailed?.(request);
    this._forgetRequest(request);
  }
}
