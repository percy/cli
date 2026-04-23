import { colors } from './utils.js';
import { HybridLogStore, sweepOrphans } from './hybrid-log-store.js';

const LINE_PAD_REGEXP = /^(\n*)(.*?)(\n*)$/s;
const URL_REGEXP = /https?:\/\/[-a-zA-Z0-9@:%._+~#=]{2,256}\.[a-z]{2,4}\b([-a-zA-Z0-9@:;%_+.~#?&//=[\]]*)/i;
const LOG_LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };

// Runs the orphan sweep at most once per process lifetime.
let orphanSweepInflight = null;

export class PercyLogger {
  level = 'info';

  namespaces = {
    include: [/^.*?$/],
    exclude: [/^ci$/, /^sdk$/]
  };

  #store = null;

  deprecations = new Set();

  static stdout = process.stdout;
  static stderr = process.stderr;

  constructor() {
    let { instance = this } = this.constructor;

    if (process.env.PERCY_DEBUG) {
      instance.debug(process.env.PERCY_DEBUG);
    } else if (process.env.PERCY_LOGLEVEL) {
      instance.loglevel(process.env.PERCY_LOGLEVEL);
    }

    this.constructor.instance = instance;

    if (!instance.#store) {
      const forceInMemory = process.env.PERCY_LOGS_IN_MEMORY === '1';
      instance.#store = new HybridLogStore({ forceInMemory });

      if (!orphanSweepInflight) {
        orphanSweepInflight = sweepOrphans().catch(() => {});
      }
    }

    return instance;
  }

  loglevel(level) {
    if (level) this.level = level;
    return this.level;
  }

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

  group(name) {
    return Object.keys(LOG_LEVELS)
      .reduce((group, level) => Object.assign(group, {
        [level]: this.log.bind(this, name, level)
      }), {
        deprecated: this.deprecated.bind(this, name),
        shouldLog: this.shouldLog.bind(this, name),
        progress: this.progress.bind(this, name),
        format: this.format.bind(this, name),
        loglevel: this.loglevel.bind(this),
        stdout: this.constructor.stdout,
        stderr: this.constructor.stderr
      });
  }

  query(filter) {
    return this.#store ? this.#store.query(filter) : [];
  }

  evictSnapshot(key) {
    if (this.#store) this.#store.evictSnapshot(key);
  }

  readBack() {
    return this.#store
      ? this.#store.readBack()
      : (async function*() {})();
  }

  toArray() {
    return this.query(() => true);
  }

  // Full teardown — closes the disk writer and removes the spill directory.
  async reset() {
    if (this.#store) await this.#store.reset();
    this.deprecations.clear();
  }

  // Sync in-memory clear without touching the disk writer. Used by the
  // /test/api/reset HTTP handler which must return synchronously.
  clearMemory() {
    if (this.#store) this.#store.clearMemory();
    this.deprecations.clear();
  }

  async dispose() {
    if (this.#store) await this.#store.dispose();
  }

  get inMemoryOnly() {
    return this.#store ? this.#store.inMemoryOnly : true;
  }

  format(debug, level, message, elapsed) {
    let color = (n, m) => this.isTTY ? colors[n](m) : m;
    let begin, end, suffix = '';
    let label = 'percy';

    if (arguments.length === 1) {
      [debug, message] = [null, debug];
    } else if (arguments.length === 2) {
      [level, message] = [null, level];
    }

    [, begin, message, end] = message.match(LINE_PAD_REGEXP);

    if (this.level === 'debug') {
      if (debug) label += `:${debug}`;

      if (elapsed != null) {
        suffix = ' ' + color('grey', `(${elapsed}ms)`);
      }
    }

    label = color('magenta', label);

    if (level === 'error') {
      message = color('red', message);
    } else if (level === 'warn') {
      message = color('yellow', message);
    } else if (level === 'info' || level === 'debug') {
      message = message.replace(URL_REGEXP, color('blue', '$&'));
    }

    return `${begin}[${label}] ${message}${suffix}${end}`;
  }

  get isTTY() {
    return !!this.constructor.stdout.isTTY;
  }

  progress(debug, message, persist) {
    if (!this.shouldLog(debug, 'info')) return;
    let { stdout } = this.constructor;

    if (this.isTTY || !this._progress) {
      message &&= this.format(debug, message);
      if (this.isTTY) stdout.cursorTo(0);
      else message &&= message + '\n';
      if (message) stdout.write(message);
      if (this.isTTY) stdout.clearLine(1);
    }

    this._progress = !!message && { message, persist };
  }

  shouldLog(debug, level) {
    return LOG_LEVELS[level] != null &&
      LOG_LEVELS[level] >= LOG_LEVELS[this.level] &&
      !this.namespaces.exclude.some(ns => ns.test(debug)) &&
      this.namespaces.include.some(ns => ns.test(debug));
  }

  deprecated(debug, message, meta) {
    if (this.deprecations.has(message)) return;
    this.deprecations.add(message);

    this.log(debug, 'warn', `Warning: ${message}`, meta);
  }

  log(debug, level, message, meta = {}) {
    let err = typeof message !== 'string' && (level === 'debug' || level === 'error');
    err &&= message.message ? Error.prototype.toString.call(message) : message.toString();

    let timestamp = Date.now();
    message = err ? (message.stack || err) : message.toString();
    let entry = { debug, level, message, meta, timestamp, error: !!err };

    if (this.#store) this.#store.push(entry);

    if (this.shouldLog(debug, level)) {
      if (err && this.level !== 'debug') message = err;
      this.write({ ...entry, message });
      this.lastlog = timestamp;
    }
  }

  write({ debug, level, message, timestamp, error }) {
    let elapsed = timestamp - (this.lastlog || timestamp);
    let msg = this.format(debug, error ? 'error' : level, message, elapsed);
    let progress = this.isTTY && this._progress;
    let { stdout, stderr } = this.constructor;

    if (progress) {
      stdout.cursorTo(0);
      stdout.clearLine(0);
    }

    (level === 'info' ? stdout : stderr).write(msg + '\n');
    if (!this._progress?.persist) delete this._progress;
    else if (progress) stdout.write(progress.message);
  }
}

export default PercyLogger;
