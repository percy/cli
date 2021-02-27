import colors from './colors';

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

  // default stdio streams can be overriden for testing
  stdout = process.stdout;
  stderr = process.stderr;

  constructor() {
    if (process.env.PERCY_DEBUG) {
      // enable debug logging for specific namespaces
      this.debug(process.env.PERCY_DEBUG);
    } else if (process.env.PERCY_LOGLEVEL) {
      // set intial log level from the environment
      this.loglevel(process.env.PERCY_LOGLEVEL);
    }
  }

  // Change log level at any time or return the current log level
  loglevel(level) {
    if (!level) return this.level;
    this.level = level;
  }

  // Change namespaces by generating an array of namespace regular expressions from a
  // comma separated debug string
  debug(namespaces) {
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
    }, { include: [], exclude: [] });
  }

  // Creates a new log group and returns level specific functions for logging
  group(name) {
    return Object.keys(LOG_LEVELS)
      .reduce((group, level) => Object.assign(group, {
        [level]: this.log.bind(this, name, level)
      }), {
        deprecated: this.deprecated.bind(this, name),
        shouldLog: this.shouldLog.bind(this, name)
      });
  }

  // Ensures that deprecation messages are not logged more than once
  deprecated(debug, message, meta) {
    if (this.deprecations.has(message)) return;
    this.deprecations.add(message);

    this.log(debug, 'warn', `Warning: ${message}`, meta);
  }

  // Returns true or false if the level and debug group can write messages to stdio
  shouldLog(debug, level) {
    return LOG_LEVELS[level] != null &&
      LOG_LEVELS[level] >= LOG_LEVELS[this.level] &&
      !this.namespaces.exclude.some(ns => ns.test(debug)) &&
      this.namespaces.include.some(ns => ns.test(debug));
  }

  // Generic log method accepts a debug group, log level, log message, and optional meta
  // information to store with the message and other info
  log(debug, level, message, meta = {}) {
    let error;

    // message must be an error object
    if (typeof message !== 'string' && (level === 'error' || level === 'debug')) {
      error = message;
      message = 'stack' in error ? error.stack : error.toString();
    }

    // timestamp each log
    let timestamp = Date.now();
    this.messages.add({ debug, level, message, meta, timestamp });

    // maybe write the message to stdio
    if (this.shouldLog(debug, level)) {
      let stdio = this[level === 'info' ? 'stdout' : 'stderr'];
      if (error && this.level !== 'debug') message = error.toString();
      let elapsed = timestamp - (this.lastlog || timestamp);
      stdio.write(this.format(message, debug, error ? 'error' : level, elapsed) + '\n');
      this.lastlog ||= timestamp;
    }
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

  // Query for a set of logs by filtering the in-memory store
  query(filter) {
    return Array.from(this.messages).filter(filter);
  }
}
