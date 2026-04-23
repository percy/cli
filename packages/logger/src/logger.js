import { colors } from './utils.js';
import { HybridLogStore } from './hybrid-log-store.js';
import { sweepOrphans } from './orphan-cleanup.js';

const LINE_PAD_REGEXP = /^(\n*)(.*?)(\n*)$/s;
const URL_REGEXP = /https?:\/\/[-a-zA-Z0-9@:%._+~#=]{2,256}\.[a-z]{2,4}\b([-a-zA-Z0-9@:;%_+.~#?&//=[\]]*)/i;
const LOG_LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };

// Module-level guard: orphan sweep runs exactly once per process lifetime,
// regardless of how many logger resets or constructor re-entries occur.
let orphanSweepInflight = null;

// A PercyLogger instance retains logs in a bounded in-memory cache backed by
// a disk JSONL file. See docs/plans/2026-04-23-001-feat-disk-backed-hybrid-log-store-plan.md
// for the full storage model. In-memory `query()` returns entries from the
// ring (global) and hot buckets (per-snapshot), not from disk; use
// `readBack()` for a full disk-backed iteration at end-of-build.
export class PercyLogger {
  // default log level
  level = 'info';

  // namespace regular expressions used to determine which debug logs to write
  namespaces = {
    include: [/^.*?$/],
    exclude: [/^ci$/, /^sdk$/]
  };

  // bounded hybrid store — lazily initialized once per singleton
  #store = null;

  // track deprecations to limit noisy logging
  deprecations = new Set();

  // once-per-logger warning that the disk fallback has kicked in (R7/R11)
  _memoryFallbackWarned = false;

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

    // One-time per-process: initialize the hybrid store and kick off an
    // orphan sweep on the first real logger construction. Subsequent
    // constructor calls return the existing singleton.
    if (!instance.#store) {
      const forceInMemory = process.env.PERCY_LOGS_IN_MEMORY === '1';
      instance.#store = new HybridLogStore({ forceInMemory });

      if (!orphanSweepInflight) {
        orphanSweepInflight = sweepOrphans().then(res => {
          if (res && res.removed > 0) {
            instance.log('logger:memory', 'debug', 'orphan-cleanup', {
              removed_count: res.removed, bytes_reclaimed: res.bytes
            });
          }
        }).catch(() => {});
      }
    }

    return instance;
  }

  // Change log level at any time or return the current log level
  loglevel(level) {
    if (level) this.level = level;
    return this.level;
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
        deprecated: this.deprecated.bind(this, name),
        shouldLog: this.shouldLog.bind(this, name),
        progress: this.progress.bind(this, name),
        format: this.format.bind(this, name),
        loglevel: this.loglevel.bind(this),
        stdout: this.constructor.stdout,
        stderr: this.constructor.stderr
      });
  }

  // Query for a set of logs in memory. Serves from the global ring and every
  // live per-snapshot bucket. Returns synchronously — existing callers
  // expecting an Array are unaffected.
  query(filter) {
    return this.#store ? this.#store.query(filter) : [];
  }

  // Public API surfaced via @percy/logger/internal for use by @percy/core.
  // Evicts a per-snapshot bucket after the snapshot has been POSTed; called
  // from the snapshot queue's task/error handler in packages/core/src/snapshot.js.
  evictSnapshot(key) {
    if (this.#store) this.#store.evictSnapshot(key);
  }

  // Async iterator over every persisted entry. Used by sendBuildLogs() to
  // stream the full log set at end-of-build without re-materializing every
  // entry in memory.
  readBack() {
    return this.#store
      ? this.#store.readBack()
      : (async function * () {})();
  }

  // Returns a plain Array of the currently in-memory entries. Replaces the
  // former `Array.from(logger.instance.messages)` pattern at
  // packages/core/src/api.js:265 (the `/test/logs` test endpoint).
  toArray() {
    return this.query(() => true);
  }

  // Public reset — clears in-memory caches, closes the disk writer, deletes
  // the spill directory, and re-initializes disk storage on the next log
  // call. Use for full test-teardown scenarios where the logger instance is
  // being replaced (e.g. `helpers.reset()`).
  async reset() {
    if (this.#store) await this.#store.reset();
    this.deprecations.clear();
    this._memoryFallbackWarned = false;
  }

  // Sync in-memory clear — discards ring + buckets + deprecations WITHOUT
  // closing the disk writer or deleting the spill directory. Suitable for
  // synchronous callers (the /test/api/reset HTTP endpoint, test beforeEach
  // hooks) that just want to wipe what's currently visible via query() /
  // toArray() without tearing down the store. Replaces the former
  // `logger.instance.messages.clear()` pattern.
  clearMemory() {
    if (this.#store && typeof this.#store.clearMemory === 'function') {
      this.#store.clearMemory();
    }
    this.deprecations.clear();
  }

  // Used by test helpers when the singleton is being discarded permanently
  // (e.g. `delete logger.constructor.instance`). Tears down the underlying
  // store: closes writer, removes spill dir, deregisters from the exit
  // handler registry. The instance is no longer usable after dispose.
  async dispose() {
    if (this.#store && typeof this.#store.dispose === 'function') {
      await this.#store.dispose();
    }
  }

  // True if the store fell back to memory-only (disk unavailable or disabled).
  get inMemoryOnly() {
    return this.#store ? this.#store.inMemoryOnly : true;
  }

  // Formats messages before they are logged to stdio
  format(debug, level, message, elapsed) {
    let color = (n, m) => this.isTTY ? colors[n](m) : m;
    let begin, end, suffix = '';
    let label = 'percy';

    if (arguments.length === 1) {
      // format(message)
      [debug, message] = [null, debug];
    } else if (arguments.length === 2) {
      // format(debug, message)
      [level, message] = [null, level];
    }

    // do not format leading or trailing newlines
    [, begin, message, end] = message.match(LINE_PAD_REGEXP);

    // include debug information
    if (this.level === 'debug') {
      if (debug) label += `:${debug}`;

      // include elapsed time since last log
      if (elapsed != null) {
        suffix = ' ' + color('grey', `(${elapsed}ms)`);
      }
    }

    // add colors
    label = color('magenta', label);

    if (level === 'error') {
      // red errors
      message = color('red', message);
    } else if (level === 'warn') {
      // yellow warnings
      message = color('yellow', message);
    } else if (level === 'info' || level === 'debug') {
      // blue info and debug URLs
      message = message.replace(URL_REGEXP, color('blue', '$&'));
    }

    return `${begin}[${label}] ${message}${suffix}${end}`;
  }

  // True if stdout is a TTY interface
  get isTTY() {
    return !!this.constructor.stdout.isTTY;
  }

  // Replaces the current line with a log message
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

  // Generic log method accepts a debug group, log level, log message, and optional meta
  // information to store with the message and other info
  log(debug, level, message, meta = {}) {
    // message might be an error-like object
    let err = typeof message !== 'string' && (level === 'debug' || level === 'error');
    err &&= message.message ? Error.prototype.toString.call(message) : message.toString();

    // save log entries
    let timestamp = Date.now();
    message = err ? (message.stack || err) : message.toString();
    let entry = { debug, level, message, meta, timestamp, error: !!err };

    if (this.#store) {
      this.#store.push(entry);
      // If the store just transitioned to fallback mode, record it as a
      // debug entry so it appears in the /logs upload for field diagnosis
      // but does NOT print to stderr (which would break tests that assert
      // on exact stdio content and isn't useful for end users). Gated on
      // PERCY_LOGS_IN_MEMORY env var to avoid firing for intentional
      // in-memory mode.
      if (this.#store.inMemoryOnly && !this._memoryFallbackWarned && process.env.PERCY_LOGS_IN_MEMORY !== '1') {
        this._memoryFallbackWarned = true;
        const sErr = this.#store.lastFallbackError;
        const reason = sErr?.code || sErr?.message || 'unknown';
        // Record in the in-memory store only — don't re-route to stdio
        // and don't recurse into push's transition check.
        this.#store.push({
          debug: 'logger:memory', level: 'debug',
          message: `logger fell back to in-memory mode: ${reason}`,
          meta: {}, timestamp, error: false
        });
      }
    }

    // maybe write the message to stdio
    if (this.shouldLog(debug, level)) {
      // unless the loglevel is debug, write shorter error messages
      if (err && this.level !== 'debug') message = err;
      this.write({ ...entry, message });
      this.lastlog = timestamp;
    }
  }

  // Writes a log entry to stdio based on the loglevel
  write({ debug, level, message, timestamp, error }) {
    let elapsed = timestamp - (this.lastlog || timestamp);
    let msg = this.format(debug, error ? 'error' : level, message, elapsed);
    let progress = this.isTTY && this._progress;
    let { stdout, stderr } = this.constructor;

    // clear any logged progress
    if (progress) {
      stdout.cursorTo(0);
      stdout.clearLine(0);
    }

    (level === 'info' ? stdout : stderr).write(msg + '\n');
    if (!this._progress?.persist) delete this._progress;
    else if (progress) stdout.write(progress.message);
  }
}

// Test-only: reset the module-level orphan-sweep guard so a fresh process
// simulation (e.g. helpers.reset(true) followed by a new constructor) can
// exercise the sweep-on-init path. Do not call from production code.
export function __resetOrphanSweepGuard() {
  orphanSweepInflight = null;
}

export default PercyLogger;
