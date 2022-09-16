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

  // keep log history of full message
  let message = err ? msg.stack : msg.toString();
  let [debug, level, timestamp, error] = [ns, lvl, Date.now(), !!err];
  (log.history ||= []).push({ debug, level, message, meta, timestamp, error });

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

export default logger;
