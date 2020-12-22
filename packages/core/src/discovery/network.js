import waitFor from '../utils/wait-for';

// The Interceptor class creates common handlers for dealing with intercepting asset requests
// for a given page using various devtools protocol events and commands.
export default class Network {
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
  async idle(timeout = this.timeout) {
    await waitFor(() => this.#requests.size === 0, {
      timeout: 30 * 1000, // 30 second error timeout
      idle: timeout
    });
  }

  // Called when a request requires authentication. Responds to the auth request with any
  // provided authentication credentials.
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
