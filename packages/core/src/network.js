import logger from '@percy/logger';
import { waitFor } from './utils';
import {
  createRequestHandler,
  createRequestFinishedHandler,
  createRequestFailedHandler
} from './discovery';

const NETWORK_TIMEOUT = 30000;

// The Interceptor class creates common handlers for dealing with intercepting asset requests
// for a given page using various devtools protocol events and commands.
export default class Network {
  #pending = new Map();
  #requests = new Map();
  #intercepts = new Map();
  #authentications = new Set();
  #frames = new Map();

  log = logger('core:network');

  constructor(page) {
    this.page = page;
    this.page.on('Fetch.authRequired', this._handleAuthRequired);
    this.page.on('Fetch.requestPaused', this._handleRequestPaused);
    this.page.on('Network.requestWillBeSent', this._handleRequestWillBeSent);
    this.page.on('Network.responseReceived', this._handleResponseReceived);
    this.page.on('Network.eventSourceMessageReceived', this._handleEventSourceMessageReceived);
    this.page.on('Network.loadingFinished', this._handleLoadingFinished);
    this.page.on('Network.loadingFailed', this._handleLoadingFailed);
    this.page.on('Page.frameDetached', this._handleFrameDetached);

    /* istanbul ignore next: race condition */
    this.page.send('Network.enable')
      .catch(e => this.log.debug(e, this.page.meta));
  }

  // Enable request interception
  async intercept(options) {
    this._intercept = true;

    this.onrequest = createRequestHandler(options, this.page.meta);
    this.onrequestfinished = createRequestFinishedHandler(options, this.page.meta);
    this.onrequestfailed = createRequestFailedHandler(options, this.page.meta);

    await this.page.send('Fetch.enable', {
      handleAuthRequests: true,
      patterns: [{ urlPattern: '*' }]
    });
  }

  // Resolves after the timeout when there are no more in-flight requests.
  async idle(filter = r => r, timeout = this.timeout || 100) {
    let getRequests = () => Array.from(this.#requests.values())
      .reduce((a, r) => filter(r) ? a.concat(r.url) : a, []);

    this.log.debug(`Wait for ${timeout}ms idle`, this.page.meta);

    try {
      await waitFor(() => {
        if (this.page.closedReason) {
          throw new Error(`Network error: ${this.page.closedReason}`);
        }

        return getRequests().length === 0;
      }, {
        timeout: NETWORK_TIMEOUT,
        idle: timeout
      });
    } catch (error) {
      // throw a better timeout error
      if (error.message.startsWith('Timeout')) {
        let msg = 'Timed out waiting for network requests to idle.';

        if (this.log.shouldLog('debug')) {
          msg += `\n\n  ${['Active requests:', ...getRequests()].join('\n  -> ')}\n`;
        }

        throw new Error(msg);
      } else {
        throw error;
      }
    }
  }

  // Called when a request should be removed from various trackers
  _forgetRequest({ requestId, interceptId, frameId }, keepPending) {
    this.#requests.delete(requestId);
    this.#authentications.delete(interceptId);
    this.#frames.delete(frameId);

    if (!keepPending) {
      this.#pending.delete(requestId);
      this.#intercepts.delete(requestId);
    }
  }

  // Called when a request requires authentication. Responds to the auth request with any
  // provided authorization credentials.
  _handleAuthRequired = async event => {
    let { username, password } = this.authorization ?? {};
    let { requestId } = event;
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
    let { networkId: requestId } = event;
    let pending = this.#pending.get(requestId);

    // guard against redirects with the same requestId
    if (pending?.request.url === event.request.url &&
        pending.request.method === event.request.method) {
      this._handleRequest(pending, event.requestId);
    }

    if (pending) {
      this.#pending.delete(requestId);
    } else {
      this.#intercepts.set(requestId, event);
    }
  }

  // Called when a request will be sent. If the request has already been intercepted, handle it;
  // otherwise set it to be pending until it is paused.
  _handleRequestWillBeSent = event => {
    let { requestId, request } = event;

    // do not handle data urls
    if (request.url.startsWith('data:')) return;

    if (this._intercept) {
      let intercept = this.#intercepts.get(requestId);
      this.#pending.set(requestId, event);

      if (intercept) {
        this._handleRequest(event, intercept.requestId);
        this.#intercepts.delete(requestId);
      }
    } else {
      this._handleRequest(event);
    }
  }

  // Called when a pending request is paused. Handles associating redirected requests with
  // responses and calls this.onrequest with request info and callbacks to continue, respond,
  // or abort a request. One of the callbacks is required to be called and only one.
  _handleRequest = async (event, interceptId) => {
    let { frameId, requestId, request } = event;
    let redirectChain = [];

    // if handling a redirected request, associate the response and add to its redirect chain
    if (event.redirectResponse && this.#requests.has(requestId)) {
      let req = this.#requests.get(requestId);
      req.response = event.redirectResponse;
      redirectChain = [...req.redirectChain, req];
      // clean up interim requests
      this._forgetRequest(req, true);
    }

    request.frameId = frameId;
    request.requestId = requestId;
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
        // call to respond with a specific status, content, and headers
        respond: ({ status, content, headers }) => this.page.send('Fetch.fulfillRequest', {
          requestId: interceptId,
          responseCode: status || 200,
          body: Buffer.from(content).toString('base64'),
          responseHeaders: Object.entries(headers || {}).map(([name, value]) => {
            return { name: name.toLowerCase(), value: String(value) };
          })
        }),
        // call to fail or abort the request
        abort: error => this.page.send('Fetch.failRequest', {
          requestId: interceptId,
          // istanbul note: this check used to be necessary and might be again in the future if we
          // ever need to abort a request due to reasons other than failures
          errorReason: error ? 'Failed' : /* istanbul ignore next */ 'Aborted'
        })
      });
    }
  }

  // Called when a response has been received for a specific request. Associates the response with
  // the request data and adds a buffer method to fetch the response body when needed.
  _handleResponseReceived = event => {
    let { requestId, response } = event;
    let request = this.#requests.get(requestId);
    /* istanbul ignore if: race condition paranioa */
    if (!request) return;

    request.response = response;
    request.response.buffer = async () => {
      let { body, base64Encoded } = await this.page.send('Network.getResponseBody', { requestId });
      return Buffer.from(body, base64Encoded ? 'base64' : 'utf8');
    };

    if (request.frameId !== this.page.frameId) {
      this.#frames.set(request.frameId, request);
    }
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
    /* istanbul ignore next: race condition paranioa */
    if (!request) return;

    if (this._intercept) {
      await this.onrequestfinished(request);
    }

    this._forgetRequest(request);
  }

  // Called when a request has failed loading and triggers the this.onrequestfailed callback.
  _handleLoadingFailed = async event => {
    let request = this.#requests.get(event.requestId);
    /* istanbul ignore if: race condition paranioa */
    if (!request) return;

    if (this._intercept) {
      request.error = event.errorText;
      await this.onrequestfailed(request);
    }

    this._forgetRequest(request);
  }

  // Called after a frame detaches from the main frame. It's likely that the frame created its own
  // process before the request finish event had a chance to be triggered.
  _handleFrameDetached = async event => {
    let request = this.#frames.get(event.frameId);
    /* istanbul ignore next: race condition paranioa */
    if (!request) return;

    if (this._intercept) {
      await this.onrequestfinished(request);
    }

    this._forgetRequest(request);
  }
}
