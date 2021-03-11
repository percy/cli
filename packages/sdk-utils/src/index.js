import logger from '@percy/logger';

// Maybe set the default CLI API address in the environment
process.env.PERCY_SERVER_ADDRESS ||= 'http://localhost:5338';

// Helper to send a request to the local CLI API
async function request(path, options = {}) {
  let url = new URL(process.env.PERCY_SERVER_ADDRESS + path);
  let status, statusMessage, headers;
  let body = '';

  if (process.env.__PERCY_BROWSERIFIED__) {
    let res = await fetch(url, options);
    ({ status, statusText: statusMessage, headers } = res);
    body = await res.text();
  } else {
    await new Promise((resolve, reject) => {
      require('http').request(url, options)
        .on('response', res => {
          ({ statusCode: status, statusMessage, headers } = res);
          res.on('data', chunk => (body += chunk.toString()));
          res.on('end', resolve);
        })
        .on('error', reject)
        .end(options.body);
    });
  }

  if (headers['content-type'] === 'application/json') {
    try { body = JSON.parse(body); } catch {}
  }

  let response = { status, statusMessage, headers, body };
  response.ok = status >= 200 && status < 300;

  if (!response.ok) {
    throw Object.assign(new Error(), {
      message: body.error || `${status} ${statusMessage}`,
      response
    });
  }

  return response;
}

// Returns CLI information
function getInfo() {
  return {
    cliApi: process.env.PERCY_SERVER_ADDRESS,
    loglevel: logger.loglevel(),
    version: getInfo.version,
    config: getInfo.config
  };
}

// Helper to create a tuple from the version string
function toVersionTuple(s) {
  return s ? s.split(/\.|-/).map(p => {
    let i = parseInt(p, 10);
    return isNaN(i) ? p : i;
  }) : [0];
}

// Create a socket to connect to a remote logger
async function connectRemoteLogger() {
  let url = process.env.PERCY_CLI_API;
  let socket;

  if (process.env__PERCY_BROWSERIFIED__) {
    socket = new WebSocket(url);
  } else {
    socket = new (require('ws'))(url);
    // allow node to exit with an active connection
    socket.once('open', () => socket._socket.unref());
  }

  await logger.remote(socket);
}

// Check if Percy is enabled using the healthcheck endpoint
async function isPercyEnabled() {
  if (isPercyEnabled.result == null) {
    let log = logger('util');
    let error;

    try {
      let { headers, body } = await request('/percy/healthcheck');
      getInfo.version = toVersionTuple(headers['x-percy-core-version']);
      getInfo.config = body.config;
      isPercyEnabled.result = true;
    } catch (e) {
      isPercyEnabled.result = false;
      error = e;
    }

    if (getInfo.version && getInfo.version[0] !== 1) {
      log.info('Unsupported Percy CLI version, disabling snapshots');
      log.debug(`Found version: ${getInfo.version}`);
      isPercyEnabled.result = false;
    } else if (!isPercyEnabled.result) {
      log.info('Percy is not running, disabling snapshots');
      log.debug(error);
    }

    if (isPercyEnabled.result) {
      await connectRemoteLogger();
    }
  }

  return isPercyEnabled.result;
}

// Fetch and cache the @percy/dom script
async function fetchPercyDOM() {
  if (fetchPercyDOM.result == null) {
    let { body } = await request('/percy/dom.js');
    fetchPercyDOM.result = body;
  }

  return fetchPercyDOM.result;
}

// Post snapshot data to the snapshot endpoint
async function postSnapshot(options) {
  await request('/percy/snapshot', {
    method: 'POST',
    body: JSON.stringify(options)
  });
}

module.exports = {
  logger,
  getInfo,
  isPercyEnabled,
  fetchPercyDOM,
  postSnapshot
};
