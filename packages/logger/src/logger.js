import { colors } from './util';

const URL_REGEXP = /\bhttps?:\/\/[^\s/$.?#].[^\s]*\b/i;
const LOG_LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };

// A PercyLogger instance retains logs in-memory for quick lookups while also writing log
// messages to stdout and stderr depending on the log level and debug string.
export default class PercyLogger {
  // default log level
  level = 'info';

  // namespace regular expressions used to determine which debug logs to write
  namespaces = {
    include: [/^.*?$/],
    exclude: []
  };

  // in-memory store for logs and meta info
  messages = new Set();

  // track deprecations to limit noisy logging
  deprecations = new Set();

  // static vars can be overriden for testing
  static stdout = process.stdout;
  static stderr = process.stderr;

  // Handles setting env var values and returns a singleton
  constructor() {
    let { instance = this } = this.constructor;

    if (process.env.PERCY_DEBUG) {
      instance.debug(process.env.PERCY_DEBUG);
    } else if (process.env.PERCY_LOGLEVEL) {
      instance.loglevel(process.env.PERCY_LOGLEVEL);
    }

    this.constructor.instance = instance;
    return instance;
  }

  // Change log level at any time or return the current log level
  loglevel(level) {
    if (!level) return this.level;
    this.level = level;
  }

  // Change namespaces by generating an array of namespace regular expressions from a
  // comma separated debug string
  debug(namespaces) {
    if (this.namespaces.string === namespaces) return;
    this.namespaces.string = namespaces;

    namespaces = namespaces.split(/[\s,]+/).filter(Boolean);
    if (!namespaces.length) return this.namespaces;
    this.loglevel('debug');

    this.namespaces = namespaces.reduce((namespaces, ns) => {
      ns = ns.replace(/:?\*/g, m => m[0] === ':' ? ':?.*?' : '.*?');

      if (ns[0] === '-') {
        namespaces.exclude.push(new RegExp('^' + ns.substr(1) + '$'));
      } else {
        namespaces.include.push(new RegExp('^' + ns + '$'));
      }

      return namespaces;
    }, {
      string: namespaces,
      include: [],
      exclude: []
    });
  }

  // Creates a new log group and returns level specific functions for logging
  group(name) {
    return Object.keys(LOG_LEVELS)
      .reduce((group, level) => Object.assign(group, {
        [level]: this.log.bind(this, name, level)
      }), {
        progress: this.progress.bind(this, name),
        deprecated: this.deprecated.bind(this, name),
        shouldLog: this.shouldLog.bind(this, name)
      });
  }

  // Query for a set of logs by filtering the in-memory store
  query(filter) {
    return Array.from(this.messages).filter(filter);
  }

  // Formats messages before they are logged to stdio
  format(message, debug, level, elapsed) {
    let label = 'percy';
    let suffix = '';

    if (this.level === 'debug') {
      // include debug info in the label
      if (debug) label += `:${debug}`;

      // include elapsed time since last log
      if (elapsed != null) {
        suffix = ' ' + colors.grey(`(${elapsed}ms)`);
      }
    }

    label = colors.magenta(label);

    if (level === 'error') {
      // red errors
      message = colors.red(message);
    } else if (level === 'warn') {
      // yellow warnings
      message = colors.yellow(message);
    } else if (level === 'info' || level === 'debug') {
      // blue info and debug URLs
      message = message.replace(URL_REGEXP, colors.blue('$&'));
    }

    return `[${label}] ${message}${suffix}`;
  }

  // Replaces the current line with a log message
  progress(debug, message, persist) {
    if (!this.shouldLog(debug, 'info')) return;
    let { stdout } = this.constructor;

    if (stdout.isTTY || !this._progress) {
      message &&= this.format(message, debug);
      if (stdout.isTTY) stdout.cursorTo(0);
      else message &&= message + '\n';
      if (message) stdout.write(message);
      if (stdout.isTTY) stdout.clearLine(1);
    }

    this._progress = !!message && { message, persist };
  }

  // Returns true or false if the level and debug group can write messages to stdio
  shouldLog(debug, level) {
    return LOG_LEVELS[level] != null &&
      LOG_LEVELS[level] >= LOG_LEVELS[this.level] &&
      !this.namespaces.exclude.some(ns => ns.test(debug)) &&
      this.namespaces.include.some(ns => ns.test(debug));
  }

  // Ensures that deprecation messages are not logged more than once
  deprecated(debug, message, meta) {
    if (this.deprecations.has(message)) return;
    this.deprecations.add(message);

    this.log(debug, 'warn', `Warning: ${message}`, meta);
  }

  // Returns true if a socket is present and ready
  get isRemote() {
    return this.socket?.readyState === 1;
  }

  // Generic log method accepts a debug group, log level, log message, and optional meta
  // information to store with the message and other info
  log(debug, level, message, meta = {}) {
    // message might be an error object
    let isError = typeof message !== 'string' && (level === 'error' || level === 'debug');
    let error = isError && message;

    // if remote, send logs there
    if (this.isRemote) {
      // serialize error messages
      message = isError && 'stack' in error ? {
        message: error.message,
        stack: error.stack
      } : message;

      return this.socket.send(JSON.stringify({
        log: [debug, level, message, { remote: true, ...meta }]
      }));
    }

    // ensure the message is a string
    message = (isError && message.stack) ||
      message.message || message.toString();

    // timestamp each log
    let timestamp = Date.now();
    let entry = { debug, level, message, meta, timestamp };
    this.messages.add(entry);

    // maybe write the message to stdio
    if (this.shouldLog(debug, level)) {
      let elapsed = timestamp - (this.lastlog || timestamp);
      if (isError && this.level !== 'debug') message = error.toString();
      this.write(level, this.format(message, debug, error ? 'error' : level, elapsed));
      this.lastlog = timestamp;
    }
  }

  // Writes a message to stdio based on the loglevel
  write(level, message) {
    let { stdout, stderr } = this.constructor;
    let progress = stdout.isTTY && this._progress;

    if (progress) {
      stdout.cursorTo(0);
      stdout.clearLine();
    }

    (level === 'info' ? stdout : stderr).write(message + '\n');

    if (!this._progress?.persist) delete this._progress;
    else if (progress) stdout.write(progress.message);
  }

  // Opens a socket logging connection
  connect(socket) {
    // send logging environment info
    let PERCY_DEBUG = process.env.PERCY_DEBUG;
    let PERCY_LOGLEVEL = process.env.PERCY_LOGLEVEL || this.loglevel();
    socket.send(JSON.stringify({ env: { PERCY_DEBUG, PERCY_LOGLEVEL } }));

    // attach remote logging handler
    socket.onmessage = ({ data }) => {
      let { log, logAll } = JSON.parse(data);
      if (logAll) logAll.forEach(e => this.messages.add(e));
      if (log) this.log(...log);
    };

    // return a cleanup function
    return () => {
      socket.onmessage = null;
    };
  }

  // Connects to a remote logger
  async remote(createSocket, timeout = 1000) {
    if (this.isRemote) return;

    // if not already connected, wait until the timeout
    let err = await new Promise(resolve => {
      let done = event => {
        if (timeoutid == null) return;
        timeoutid = clearTimeout(timeoutid);
        if (this.socket) this.socket.onopen = this.socket.onerror = null;
        resolve(event?.error || (event?.type === 'error' && (
          'Error: Socket connection failed')));
      };

      let timeoutid = setTimeout(done, timeout, {
        error: 'Error: Socket connection timed out'
      });

      Promise.resolve().then(async () => {
        this.socket = await createSocket();
        if (this.isRemote) return done();
        this.socket.onopen = this.socket.onerror = done;
      }).catch(error => done({ error }));
    });

    // there was an error connecting, will fallback to normal logging
    if (err) {
      this.log('logger', 'debug', 'Unable to connect to remote logger');
      this.log('logger', 'debug', err);
      return;
    }

    // send any messages already logged in this environment
    if (this.messages.size) {
      this.socket.send(JSON.stringify({
        logAll: Array.from(this.messages).map(entry => ({
          ...entry, meta: { remote: true, ...entry.meta }
        }))
      }));
    }

    // attach an incoming message handler
    this.socket.onmessage = ({ data }) => {
      let { env } = JSON.parse(data);
      // update local environment info
      if (env) Object.assign(process.env, env);
    };

    // return a cleanup function
    return () => {
      this.socket.onmessage = null;
      this.socket = null;
    };
  }
}
