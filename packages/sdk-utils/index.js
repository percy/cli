// Maybe get the CLI API address and loglevel from the environment
const {
  PERCY_CLI_API = 'http://localhost:5338',
  PERCY_LOGLEVEL = 'info'
} = process.env;

// Helper to send a request to the local CLI API
function request(path, { body, ...options } = {}) {
  let { protocol, hostname, port, pathname, search } = new URL(PERCY_CLI_API + path);
  options = { ...options, protocol, hostname, port, path: pathname + search };

  return new Promise((resolve, reject) => {
    require('http').request(options)
      .on('response', res => {
        let { statusCode, statusMessage, headers } = res;
        let raw = '';

        res.setEncoding('utf8');
        res.on('data', chunk => (raw += chunk));
        res.on('end', () => {
          let r = { statusCode, statusMessage, headers, body: raw };

          if (headers['content-type'] === 'application/json') {
            try { r.body = JSON.parse(raw); } catch (e) {}
          }

          if (statusCode >= 200 && statusCode < 300) {
            resolve(r);
          } else {
            reject(Object.assign(new Error(), {
              message: r.body.error || `${statusCode} ${statusMessage}`,
              response: r
            }));
          }
        });
      })
      .on('error', reject)
      .end(body);
  });
}

// Log colored labels and errors using loglevels
let linereg = /^.*$/gm;
function log(level, msg) {
  let l = { debug: 0, info: 1, warn: 2, error: 3 };
  if (l[PERCY_LOGLEVEL] == null || l[level] < l[PERCY_LOGLEVEL]) return;
  let c = (n, s) => s.replace(linereg, l => `\u001b[${n}m${l}\u001b[39m`);

  if (level === 'error' || msg.stack) {
    msg = (PERCY_LOGLEVEL === 'debug' && msg.stack) || msg.toString();
    console.error(`[${c(35, 'percy')}] ${c(31, msg)}`);
  } else if (level === 'warn') {
    console.warn(`[${c(35, 'percy')}] ${c(33, msg)}`);
  } else {
    console.log(`[${c(35, 'percy')}] ${msg}`);
  }
}

// Returns CLI information
function getInfo() {
  return {
    cliApi: PERCY_CLI_API,
    loglevel: PERCY_LOGLEVEL,
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

// Check if Percy is enabled using the healthcheck endpoint
async function isPercyEnabled() {
  if (isPercyEnabled.result == null) {
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
      log('info', 'Unsupported Percy CLI version, disabling snapshots');
      log('debug', `Found version: ${getInfo.version}`);
      isPercyEnabled.result = false;
    } else if (!isPercyEnabled.result) {
      log('info', 'Percy is not running, disabling snapshots');
      log('debug', error);
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
  log,
  getInfo,
  isPercyEnabled,
  fetchPercyDOM,
  postSnapshot
};
