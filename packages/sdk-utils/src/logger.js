import percy from './percy-info.js';

// Used when determining if a message should be logged
const LOG_LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };

// Create a small logger util using the specified namespace
export function logger(namespace) {
  return Object.keys(LOG_LEVELS).reduce((ns, lvl) => (
    Object.assign(ns, { [lvl]: (...a) => logger.log(namespace, lvl, ...a) })
  ), {});
}

// Set and/or return the local loglevel
const loglevel = logger.loglevel = lvl => {
  return (loglevel.lvl = lvl || loglevel.lvl || process.env.PERCY_LOGLEVEL || 'info');
};

// Track and send/write logs for the specified namespace and log level
const log = logger.log = (ns, lvl, msg, meta) => {
  let err = typeof msg !== 'string' && (lvl === 'error' || lvl === 'debug');
  meta = { remote: true, ...meta };

  if (remote.socket) {
    // prefer remote logging when available and serialize any errors
    if (err) msg = { name: msg.name, message: msg.message, stack: msg.stack };
    return remote.socket.send(JSON.stringify({ log: [ns, lvl, msg, meta] }));
  } else {
    // keep log history of full message when not remote
    let message = err ? msg.stack : msg.toString();
    let [debug, level, timestamp, error] = [ns, lvl, Date.now(), !!err];
    (log.history ||= []).push({ debug, level, message, meta, timestamp, error });
  }

  // check if the specific level is within the local loglevel range
  if (LOG_LEVELS[lvl] != null && LOG_LEVELS[lvl] >= LOG_LEVELS[loglevel()]) {
    let debug = loglevel() === 'debug';
    let label = debug ? `percy:${ns}` : 'percy';

    // colorize the label when possible for consistency with the CLI logger
    if (!process.env.__PERCY_BROWSERIFIED__) label = `\u001b[95m${label}\u001b[39m`;
    msg = `[${label}] ${(err && debug && msg.stack) || msg}`;

    if (process.env.__PERCY_BROWSERIFIED__) {
      // use console[warn|error|log] in browsers
      console[['warn', 'error'].includes(lvl) ? lvl : 'log'](msg);
    } else {
      // use process[stdout|stderr].write in node
      process[lvl === 'info' ? 'stdout' : 'stderr'].write(msg + '\n');
    }
  }
};

// Create a new WebSocket and resolve with it once connected
async function createWebSocket(address, timeout = 1000) {
  // attempt to import `ws` in node environments
  let WebSocket = process.env.__PERCY_BROWSERIFIED__
  /* eslint-disable-next-line import/no-extraneous-dependencies */
    ? window.WebSocket : (await import('ws')).default;
  let ws = new WebSocket(address.replace(/^http/, 'ws'));

  return new Promise((resolve, reject) => {
    let done = ws.onopen = ws.onerror = e => {
      ws._socket?.unref();
      clearTimeout(timeoutid);
      ws.onopen = ws.onerror = null;
      if (!e.error && e.type !== 'error') return resolve(ws);
      else reject(e.error || 'Error: Socket connection failed');
    };

    let timeoutid = setTimeout(done, timeout, {
      error: 'Error: Socket connection timed out'
    });
  });
}

// Connect to a remote logger at the specified address within the timeout
const remote = logger.remote = async timeout => {
  try {
    // already connected
    if (remote.socket?.readyState === 1) return;
    // connect to namespaced logging address
    let address = new URL('/logger', percy.address).href;
    // create and cache a websocket connection
    let ws = remote.socket = await createWebSocket(address, timeout);
    // accept loglevel updates
    /* istanbul ignore next: difficult to test currently */
    ws.onmessage = e => loglevel(JSON.parse(e.data).loglevel);
    // cleanup message handler on close
    ws.onclose = () => (remote.socket = (ws.onmessage = (ws.onclose = null)));
    // send any messages already logged in this environment
    if (log.history) ws.send(JSON.stringify({ messages: log.history }));
  } catch (err) {
    // there was an error connecting, will fallback to minimal logging
    logger.log('utils', 'debug', 'Unable to connect to remote logger');
    logger.log('utils', 'debug', err);
  }
};

export default logger;
