import fs from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { randomBytes } from 'crypto';
import { colors } from './utils.js';

const LINE_PAD_REGEXP = /^(\n*)(.*?)(\n*)$/s;
const URL_REGEXP = /https?:\/\/[-a-zA-Z0-9@:%._+~#=]{2,256}\.[a-z]{2,4}\b([-a-zA-Z0-9@:;%_+.~#?&//=[\]]*)/i;
const LOG_LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };

const FLUSH_AT_ENTRIES = 500;
const FLUSH_TIMER_MS = 100;
const READ_CHUNK_BYTES = 64 * 1024;

// Hooks latch + active-instance set kept on the `process` object via Symbol.for
// so that they are shared across module copies (the ESM loader-mock path used
// by tests creates fresh module instances; a module-scoped variable would let
// each one register its own listener and accumulate into MaxListenersWarning).
// Using a Set rather than a single pointer also handles transitional states
// where two PercyLogger instances are alive at once (e.g. test setups that
// don't reset between cases) — both files get cleaned at exit.
const EXIT_HOOKS_INSTALLED = Symbol.for('@percy/logger.exitHooksInstalled');
const ACTIVE_INSTANCES = Symbol.for('@percy/logger.activeInstances');

// A PercyLogger writes logs to stdout/stderr and persists every entry to a
// JSONL file under os.tmpdir()/percy-logs/<pid>/, keeping resident memory
// bounded across long builds. Falls back to an unbounded in-memory Set if
// disk is unavailable (or if the rollback env var PERCY_LOGS_IN_MEMORY is set).
export class PercyLogger {
  level = 'info';

  namespaces = {
    include: [/^.*?$/],
    exclude: [/^ci$/, /^sdk$/]
  };

  deprecations = new Set();

  // disk-backed store state
  diskMode = 'disk';
  diskPath = null;
  diskSize = 0;
  writeBuffer = [];
  flushTimer = null;
  // snapshotLogs cache: Map<key, entry[]>. Bounded by # of un-evicted snapshot
  // keys at any moment; evictSnapshot() drops them. Late entries that arrive
  // after eviction repopulate the cache — that is intentional, so retry/
  // re-discovery flows that snapshotLogs(meta) again still see them.
  cache = new Map();
  cacheCursor = 0;
  fallback = null;
  writeFailureWarned = false;

  static stdout = process.stdout;
  static stderr = process.stderr;

  constructor() {
    let { instance = this } = this.constructor;

    if (process.env.PERCY_DEBUG) {
      instance.debug(process.env.PERCY_DEBUG);
    } else if (process.env.PERCY_LOGLEVEL) {
      instance.loglevel(process.env.PERCY_LOGLEVEL);
    }

    // If the rollback / test env var is set, flip to memory mode immediately so
    // log() never goes through the disk buffer at all. Drain any entries that
    // were already queued in disk mode so they aren't stranded after the flip.
    if (process.env.PERCY_LOGS_IN_MEMORY === '1' &&
        instance.diskMode === 'disk' && !instance.diskPath) {
      instance.diskMode = 'memory';
      instance.fallback ??= new Set();
      /* istanbul ignore if: only triggered when env=1 is set after logs have already buffered */
      if (instance.writeBuffer.length) instance._drainBufferToMemory();
    }

    this.constructor.instance = instance;
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

  // Returns matching entries. In memory mode, callers see the live fallback
  // Set entries (mutations persist). In disk mode, each call streams a fresh
  // pass over the JSONL — production callers (sendBuildLogs) only need the
  // upload payload, which is the value redactSecrets returns, not a mutation
  // side-effect. Tests rely on identity preservation and run in memory mode.
  query(filter) {
    if (this.diskMode === 'memory') {
      return Array.from(this.fallback).filter(filter);
    }

    this._flushSync();
    if (this.diskMode === 'memory') {
      return Array.from(this.fallback).filter(filter);
    }
    return this._scanDisk(filter);
  }

  // Returns entries tagged with the given snapshot meta. In disk mode, reads
  // only the disk delta since the last call to amortize the work in defer
  // mode (snapshots accumulate; logs route through the cache lazily).
  snapshotLogs(meta) {
    let key = this._snapshotKey({ snapshot: meta });
    if (!key) return [];

    if (this.diskMode === 'memory') {
      return this._filterFallback(key);
    }

    this._flushSync();
    /* istanbul ignore if: defensive — _flushSync only flips mode via _fallbackToMemory, which our snapshotLogs tests don't exercise mid-call */
    if (this.diskMode === 'memory') {
      return this._filterFallback(key);
    }
    this._refreshCache();
    return this.cache.get(key) || [];
  }

  evictSnapshot(meta) {
    let key = this._snapshotKey({ snapshot: meta });
    if (!key) return;
    this.cache.delete(key);
  }

  // Resets all logger state. Cleans up the disk file; next log will lazily reinit.
  reset() {
    // Why: discard buffered entries before _cleanup — between tests, the old
    // diskPath may reference a file from a prior mockfs volume that no longer
    // exists in the real fs. Letting _flushSync run would trip ENOENT and
    // emit the disk-fallback warning into the next test's captured stderr.
    this.writeBuffer = [];
    /* istanbul ignore if: defensive — the only code path that schedules a
       timer also drains via query() before reset() in tests */
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    this._cleanup();
    process[ACTIVE_INSTANCES]?.delete(this);
    this.diskPath = null;
    this.diskSize = 0;
    this.cache.clear();
    this.cacheCursor = 0;
    this.fallback = null;
    this.diskMode = 'disk';
    this.writeFailureWarned = false;
    this.deprecations = new Set();
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

    this._record(entry);

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

  // ── internals ───────────────────────────────────────────────────────────────

  _filterFallback(key) {
    let result = [];
    for (let entry of this.fallback) {
      if (this._snapshotKey(entry?.meta) === key) result.push(entry);
    }
    return result;
  }

  _record(entry) {
    if (this.diskMode === 'memory') {
      this.fallback.add(entry);
      return;
    }

    let line;
    try {
      line = JSON.stringify(entry) + '\n';
    } catch {
      // Why: circular references in meta would otherwise kill this log call.
      // Preserve meta.snapshot so the entry still routes via snapshotLogs.
      let safeMeta = { unserializable: true };
      if (entry.meta?.snapshot) safeMeta.snapshot = entry.meta.snapshot;
      entry = { ...entry, meta: safeMeta };
      line = JSON.stringify(entry) + '\n';
    }

    let length = Buffer.byteLength(line, 'utf8');
    this.writeBuffer.push({ line, length });
    this._scheduleFlush();

    if (this.writeBuffer.length >= FLUSH_AT_ENTRIES) this._flushSync();
  }

  _snapshotKey(meta) {
    let s = meta?.snapshot;
    if (!s || (!s.testCase && !s.name)) return null;
    return `${s.testCase || ''}|${s.name || ''}`;
  }

  _scheduleFlush() {
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      this._flushSync();
    }, FLUSH_TIMER_MS);
    this.flushTimer.unref?.();
  }

  _flushSync() {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    if (!this.writeBuffer.length) return;

    this._ensureDiskInit();
    if (this.diskMode !== 'disk') {
      this._drainBufferToMemory();
      return;
    }

    let chunk = '';
    let written = 0;
    for (let item of this.writeBuffer) {
      chunk += item.line;
      written += item.length;
    }

    try {
      fs.appendFileSync(this.diskPath, chunk);
    } catch (err) {
      this._fallbackToMemory(err);
      return;
    }

    this.diskSize += written;
    this.writeBuffer = [];
  }

  _drainBufferToMemory() {
    /* istanbul ignore next: defensive — fallback is always set before drain runs */
    if (!this.fallback) this.fallback = new Set();
    for (let { line } of this.writeBuffer) {
      /* istanbul ignore next: defensive — entries are JSON.stringify'd by us */
      try { this.fallback.add(JSON.parse(line.replace(/\n$/, ''))); } catch { /* skip */ }
    }
    this.writeBuffer = [];
  }

  _ensureDiskInit() {
    if (this.diskPath || this.diskMode !== 'disk') return;

    try {
      // Per-pid subdir keeps concurrent percy processes (CI matrix, parallel
      // test workers, npx invocations) from clobbering each other's files.
      let dir = join(tmpdir(), 'percy-logs', String(process.pid));
      fs.mkdirSync(dir, { recursive: true });
      this.diskPath = join(
        dir,
        `${Date.now()}-${randomBytes(8).toString('hex')}.jsonl`
      );
      fs.writeFileSync(this.diskPath, '');
      this._installExitHooks();
    } catch {
      this.diskMode = 'memory';
      /* istanbul ignore next: defensive — fallback may already be set */
      this.fallback ??= new Set();
      this.diskPath = null;
    }
  }

  // Reads the disk delta into the snapshotLogs cache, grouped by snapshotKey.
  _refreshCache() {
    if (this.cacheCursor >= this.diskSize) return;

    let length = this.diskSize - this.cacheCursor;
    let fd = fs.openSync(this.diskPath, 'r');

    try {
      let buf = Buffer.alloc(length);
      fs.readSync(fd, buf, 0, length, this.cacheCursor);
      let lines = buf.toString('utf8').split('\n');
      // Trailing empty after the final newline.
      lines.pop();
      for (let line of lines) {
        let entry;
        /* istanbul ignore next: defensive — entries are JSON.stringify'd by us */
        try { entry = JSON.parse(line); } catch { continue; }
        let key = this._snapshotKey(entry?.meta);
        if (!key) continue;
        let arr = this.cache.get(key);
        if (!arr) this.cache.set(key, arr = []);
        arr.push(entry);
      }
      this.cacheCursor = this.diskSize;
    } finally {
      fs.closeSync(fd);
    }
  }

  // Streams the JSONL once and returns matching entries. Each call parses
  // afresh — no parsed-entry cache, so RSS at upload time stays bounded by
  // the size of the filtered result rather than the total log volume.
  _scanDisk(filter) {
    if (!this.diskPath || this.diskSize === 0) return [];

    let result = [];
    let fd = fs.openSync(this.diskPath, 'r');

    try {
      let buf = Buffer.alloc(READ_CHUNK_BYTES);
      let offset = 0;
      let partial = '';
      while (offset < this.diskSize) {
        let toRead = Math.min(READ_CHUNK_BYTES, this.diskSize - offset);
        let n = fs.readSync(fd, buf, 0, toRead, offset);
        offset += n;
        let lines = (partial + buf.slice(0, n).toString('utf8')).split('\n');
        partial = lines.pop();
        for (let line of lines) {
          /* istanbul ignore next: defensive — entries are JSON.stringify'd by us */
          try {
            let entry = JSON.parse(line);
            if (filter(entry)) result.push(entry);
          } catch { /* skip */ }
        }
      }
    } finally {
      fs.closeSync(fd);
    }
    return result;
  }

  _fallbackToMemory(err) {
    /* istanbul ignore else: latch — only fires once per build */
    if (!this.writeFailureWarned) {
      this.writeFailureWarned = true;
      PercyLogger.stderr.write(
        `[percy] logger: disk write failed (${err?.code || err?.message || 'unknown'}), falling back to in-memory\n`
      );
    }

    // Read whatever we already wrote to disk into the fallback Set so /logs
    // upload still includes everything from before the failure.
    let existing = [];
    if (this.diskPath && this.diskSize > 0) {
      /* istanbul ignore next: defensive — _scanDisk handles its own errors */
      try { existing = this._scanDisk(() => true); } catch { /* tolerate */ }
    }

    this.diskMode = 'memory';
    /* istanbul ignore next: defensive — fallback may already be set */
    this.fallback ??= new Set();
    for (let entry of existing) this.fallback.add(entry);
    this._drainBufferToMemory();

    /* istanbul ignore else: latch — diskPath always set on first fallback */
    if (this.diskPath) {
      /* istanbul ignore next: defensive — best-effort cleanup */
      try { fs.unlinkSync(this.diskPath); } catch { /* tolerate */ }
      this.diskPath = null;
    }
    this.diskSize = 0;
    this.cache.clear();
    this.cacheCursor = 0;
  }

  _installExitHooks() {
    let active = process[ACTIVE_INSTANCES] ??= new Set();
    active.add(this);
    /* istanbul ignore if: latch — only the first install per process */
    if (process[EXIT_HOOKS_INSTALLED]) return;
    process[EXIT_HOOKS_INSTALLED] = true;
    let cleanup = () => {
      for (let logger of process[ACTIVE_INSTANCES]) logger._cleanup();
    };
    process.once('exit', cleanup);
    process.once('beforeExit', cleanup);
    // Why: SIGINT/SIGTERM are intentionally not handled. The CLI runtime
    // already installs its own signal listeners; adding ours pushes past
    // the default 10-listener limit and trips MaxListenersExceededWarning
    // in downstream test suites. On Ctrl-C / runner kill our JSONL is left
    // in os.tmpdir()/percy-logs/<pid>/ which the OS cleans, and the
    // pid-scoped subdir prevents concurrent runs from colliding.
  }

  _cleanup() {
    /* istanbul ignore next: defensive — flush should not throw */
    try { this._flushSync(); } catch { /* tolerate */ }
    if (this.diskPath) {
      let dir = dirname(this.diskPath);
      /* istanbul ignore next: defensive — best-effort */
      try { fs.unlinkSync(this.diskPath); } catch { /* tolerate */ }
      // Best-effort rmdir of the per-pid subdir so long-lived runners don't
      // accumulate empty directories. Fails harmlessly if peer instances of
      // the same pid still hold files there.
      /* istanbul ignore next: defensive — best-effort */
      try { fs.rmdirSync(dir); } catch { /* tolerate */ }
    }
  }
}

export default PercyLogger;
