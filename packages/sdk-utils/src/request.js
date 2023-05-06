import percy from './percy-info.js';

// Helper to send a request to the local CLI API
export async function request(path, options = {}) {
  let url = path;
  if (!path.startsWith('http')) {
    url = `${percy.address}${path}`;
  }
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
    body: JSON.stringify(json)
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
    let { default: http } = await import(protocol === 'https:' ? 'https' : 'http');

    return new Promise((resolve, reject) => {
      http.request(url, options)
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
