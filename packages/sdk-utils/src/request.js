import percy from './percy-info.js';

// Helper to send a request to the local CLI API
export async function request(path, options = {}) {
  let url = path.startsWith('http') ? path : `${percy.address}${path}`;
  let response = await request.fetch(url, options);

  // maybe parse response body as json
  if (typeof response.body === 'string' &&
      response.headers['content-type'] === 'application/json') {
    try { response.body = JSON.parse(response.body); } catch (e) {}
  }

  // throw an error if status is not ok
  if (!(response.status >= 200 && response.status < 300)) {
    throw Object.assign(new Error(), {
      message: response.body.error ||
      /* istanbul ignore next: in tests, there's always an error message */
        `${response.status} ${response.statusText}`,
      response
    });
  }

  return response;
}

request.post = function post(url, json) {
  return request(url, {
    method: 'POST',
    body: JSON.stringify(json),
    timeout: 600000
  });
};

// environment specific implementation
if (process.env.__PERCY_BROWSERIFIED__) {
  // use window.fetch in browsers
  const winFetch = window.fetch;

  request.fetch = async function fetch(url, options) {
    let response = await winFetch(url, options);

    return {
      status: response.status,
      statusText: response.statusText,
      headers: Object.fromEntries(response.headers.entries()),
      body: await response.text()
    };
  };
} else {
  // use http.request in node
  request.fetch = async function fetch(url, options) {
    let { protocol } = new URL(url);
    // rollup throws error for -> await import(protocol === 'https:' ? 'https' : 'http')
    let { default: http } = protocol === 'https:' ? await import('https') : await import('http');

    return new Promise(async (resolve, reject) => {
      // Use proxy agent if available
      const requestOptions = { ...options };
      
      // Try to get proxy agent using Function constructor to avoid Babel transformation
      try {
        const dynamicImport = new Function('specifier', 'return import(specifier)');
        const { proxyAgentFor } = await dynamicImport('@percy/client/utils');
        const agent = proxyAgentFor(url);
        if (agent) {
          requestOptions.agent = agent;
        }
      } catch (error) {
        // Silently continue without proxy - this is expected when @percy/client is not available
        // Only log in development/debug scenarios
        if (process.env.NODE_ENV === 'development' && typeof window === 'undefined') {
          console.warn('Proxy agent not available:', error.message);
        }
      }

      http.request(url, requestOptions)
        .on('response', response => {
          let body = '';

          response.on('data', chunk => (body += chunk.toString()));
          response.on('end', () => resolve({
            status: response.statusCode,
            statusText: response.statusMessage,
            headers: response.headers,
            body
          }));
        })
        .on('error', reject)
        .end(options.body);
    });
  };
}

export default request;
