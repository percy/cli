import {
  promises as fsp, createWriteStream, createReadStream,
  mkdtempSync, chmodSync, writeFileSync, unlinkSync, rmSync
} from 'fs';
import { createInterface } from 'readline';
import os from 'os';
import path from 'path';

import { redactString } from './redact.js';

export const DIR_PREFIX = 'percy-logs-';
const DEFAULT_RING_SIZE = Number(process.env.PERCY_LOG_RING_SIZE) || 2000;
const MAX_STREAM_BUFFER = 1 * 1024 * 1024;
const CLOSE_TIMEOUT_MS = 2000;
const ORPHAN_TTL_MS = 24 * 60 * 60 * 1000;
const IS_WINDOWS = process.platform === 'win32';

// Process-wide registry so exit handlers register once regardless of how many
// stores the process creates. Without this, Node hits MaxListeners=10 after
// about 4 test lifecycles.
const activeStores = new Set();
let processHandlersRegistered = false;
function ensureProcessHandlers() {
  if (processHandlersRegistered) return;
  processHandlersRegistered = true;
  const syncAll = () => { for (const store of activeStores) store._syncCleanup(); };
  process.on('exit', syncAll);
  const signalExit = () => { syncAll(); process.exit(130); };
  process.once('SIGINT', signalExit);
  process.once('SIGTERM', signalExit);
}

function safeReplacer() {
  const seen = new WeakSet();
  return function(_key, value) {
    if (typeof value === 'string') return redactString(value);
    if (value === null || typeof value !== 'object') {
      if (typeof value === 'bigint') return value.toString();
      if (typeof value === 'function' || typeof value === 'symbol') return undefined;
      return value;
    }
    if (seen.has(value)) return '[Circular]';
    seen.add(value);
    if (value instanceof Error) {
      return { name: value.name, message: value.message, stack: value.stack };
    }
    // Buffer.toJSON() fires before the replacer, yielding { type, data: [...] }
    if (value && value.type === 'Buffer' && Array.isArray(value.data)) {
      return { type: 'Buffer', base64: Buffer.from(value.data).toString('base64') };
    }
    if (typeof Buffer !== 'undefined' && Buffer.isBuffer(value)) {
      return { type: 'Buffer', base64: value.toString('base64') };
    }
    return value;
  };
}

export function safeStringify(obj) {
  try {
    return JSON.stringify(obj, safeReplacer());
  } catch (_) {
    /* istanbul ignore next */
    return JSON.stringify({
      _unstringifiable: true,
      typeName: Object.prototype.toString.call(obj)
    });
  }
}

// Round-trip so in-memory caches hold redacted, serializable clones.
export function sanitizeMeta(meta) {
  if (meta == null || typeof meta !== 'object') return meta;
  try { return JSON.parse(safeStringify(meta)); } catch (_) {
    /* istanbul ignore next */
    return {};
  }
}

export class HybridLogStore {
  #ring;
  #ringCap;
  #ringHead = 0;
  #ringSize = 0;
  #buckets = new Map();

  #writer = null;
  #spillDir = null;
  #spillFilePath = null;
  #needsDrain = false;
  #lastDiskTimestamp = 0;

  #inMemoryOnly;
  #forcedInMemory;

  lastFallbackError = null;

  constructor({ ringCap = DEFAULT_RING_SIZE, forceInMemory = false } = {}) {
    this.#ringCap = ringCap;
    this.#forcedInMemory = forceInMemory;
    this.#inMemoryOnly = forceInMemory;
    this.#ring = new Array(ringCap);
    if (!forceInMemory) this.#initDisk();
    activeStores.add(this);
    ensureProcessHandlers();
  }

  // Memory before disk: an entry is guaranteed visible via query() even if
  // the async write fails. Redaction also happens here so in-memory copies
  // match disk contents.
  push(entry) {
    const sanitized = sanitizeMeta(entry) || entry;
    this.#routeInMemory(sanitized);
    this.#writeDisk(sanitized);
  }

  query(filter) {
    const results = [];
    for (let i = 0; i < this.#ringSize; i++) {
      const idx = (this.#ringHead - this.#ringSize + i + this.#ringCap) % this.#ringCap;
      const e = this.#ring[idx];
      if (filter(e)) results.push(e);
    }
    return results;
  }

  evictSnapshot(key) {
    if (key != null) this.#buckets.delete(key);
  }

  // Sync discard. Leaves the disk writer and spill directory untouched so
  // callers (e.g. the /test/api/reset endpoint) can keep logging without
  // reopening the stream.
  clearMemory() {
    this.#ring = new Array(this.#ringCap);
    this.#ringHead = 0;
    this.#ringSize = 0;
    this.#buckets.clear();
  }

  // Disk first, then in-memory fallback for entries newer than the last disk
  // record — covers systemd-tmpfiles unlinking the spill file while the
  // writer fd is still open.
  async *readBack() {
    let lastTs = 0;
    let diskYielded = false;
    let diskFailed = false;
    if (this.#spillFilePath) {
      try {
        const rl = createInterface({
          input: createReadStream(this.#spillFilePath),
          crlfDelay: Infinity
        });
        for await (const line of rl) {
          if (!line) continue;
          try {
            const entry = JSON.parse(line);
            if (typeof entry.timestamp === 'number' && entry.timestamp > lastTs) {
              lastTs = entry.timestamp;
            }
            diskYielded = true;
            yield entry;
          } catch (_) { /* crash-truncated tail */ }
        }
      } catch (_) {
        diskFailed = true;
      }
    }
    const shouldYieldMemory = this.#inMemoryOnly || !this.#spillFilePath ||
                              diskFailed || !diskYielded;
    if (shouldYieldMemory) {
      for (const e of this.query(() => true)) {
        if (typeof e.timestamp !== 'number' || e.timestamp > lastTs) yield e;
      }
    }
  }

  async reset() {
    this.clearMemory();
    this.#needsDrain = false;
    this.#lastDiskTimestamp = 0;

    await this.#closeWriter();
    await this.#cleanupSpillDir();
    this.#spillDir = null;
    this.#spillFilePath = null;

    if (!this.#forcedInMemory) {
      this.#inMemoryOnly = false;
      this.lastFallbackError = null;
      this.#initDisk();
    }
  }

  // Terminal teardown for tests that are about to discard the singleton.
  async dispose() {
    this.clearMemory();
    this.#needsDrain = false;
    this.#lastDiskTimestamp = 0;

    await this.#closeWriter();
    await this.#cleanupSpillDir();
    this.#spillDir = null;
    this.#spillFilePath = null;
    this.#inMemoryOnly = true;
    activeStores.delete(this);
  }

  get inMemoryOnly() { return this.#inMemoryOnly; }
  get spillDir() { return this.#spillDir; }

  #routeInMemory(entry) {
    this.#ring[this.#ringHead] = entry;
    this.#ringHead = (this.#ringHead + 1) % this.#ringCap;
    if (this.#ringSize < this.#ringCap) this.#ringSize++;

    const key = snapshotKey(entry.meta);
    if (key) {
      let bucket = this.#buckets.get(key);
      if (!bucket) { bucket = []; this.#buckets.set(key, bucket); }
      bucket.push(entry);
    }
  }

  #initDisk() {
    try {
      const tmp = os.tmpdir();
      if (isUnsafeWindowsTmpdir(tmp)) {
        throw Object.assign(
          new Error('tmpdir not user-scoped on Windows; refusing to spill'),
          { code: 'PERCY_UNSAFE_TMPDIR' }
        );
      }

      // mkdtempSync is atomic and collision-free — prevents symlink squat.
      const dir = mkdtempSync(path.join(tmp, DIR_PREFIX));
      if (!IS_WINDOWS) { try { chmodSync(dir, 0o700); } catch (_) {} }

      const probe = path.join(dir, '.probe');
      writeFileSync(probe, '');
      unlinkSync(probe);
      writeFileSync(path.join(dir, 'pid'), String(process.pid));

      this.#spillDir = dir;
      this.#spillFilePath = path.join(dir, 'build.log.jsonl');
      this.#writer = createWriteStream(this.#spillFilePath, { flags: 'a' });
      this.#writer.on('error', (err) => this.#transitionToMemory(err));
      this.#writer.on('drain', () => { this.#needsDrain = false; });
    } catch (err) {
      this.#transitionToMemory(err);
    }
  }

  #writeDisk(entry) {
    if (this.#inMemoryOnly || !this.#writer) return;
    const result = tryDiskWrite(this.#writer, entry, {
      needsDrain: this.#needsDrain,
      maxBuffer: MAX_STREAM_BUFFER
    });
    this.#needsDrain = result.needsDrain;
    if (result.err) { this.#transitionToMemory(result.err); return; }
    if (result.queuedOnly) return;
    if (typeof entry.timestamp === 'number' && entry.timestamp > this.#lastDiskTimestamp) {
      this.#lastDiskTimestamp = entry.timestamp;
    }
  }

  #transitionToMemory(err) {
    if (this.#inMemoryOnly) return;
    this.#inMemoryOnly = true;
    this.lastFallbackError = err;
    this.#closeWriter().catch(() => {});
  }

  async #closeWriter() {
    const w = this.#writer;
    this.#writer = null;
    if (!w) return;
    // Windows AV scanners can hang end(); race it with a destroy.
    await raceEndAgainstDestroy(w, CLOSE_TIMEOUT_MS);
  }

  async #cleanupSpillDir() {
    if (!this.#spillDir) return;
    try {
      await fsp.rm(this.#spillDir, {
        recursive: true, force: true, maxRetries: 3, retryDelay: 100
      });
    } catch (_) {}
  }

  _syncCleanup() {
    try { if (this.#writer) this.#writer.end(); } catch (_) {}
    try {
      if (this.#spillDir) {
        rmSync(this.#spillDir, { recursive: true, force: true, maxRetries: 3 });
      }
    } catch (_) {}
  }
}

// Pure-function helpers — exported so their edge-case branches can be
// exercised without spinning up a full HybridLogStore.

// True when the given tmpdir is the world-readable Windows system temp.
// Some CI runners expose C:\Windows\Temp; disk spill there leaks secrets.
export function isUnsafeWindowsTmpdir(tmp, isWindows = IS_WINDOWS) {
  return isWindows && /^[A-Z]:\\Windows\\Temp$/i.test(tmp);
}

// Attempts a single write to a WriteStream. Returns a plain object so the
// caller can update state without leaking stream internals. Captures the
// two failure modes independently of #HybridLogStore:
//   - Backpressure: writableLength already over cap → queuedOnly = true
//   - Sync throw (writer destroyed or invalid chunk) → err populated
export function tryDiskWrite(writer, entry, opts) {
  const state = { needsDrain: !!opts.needsDrain };
  if (state.needsDrain || writer.writableLength > opts.maxBuffer) {
    state.needsDrain = true;
    return { ...state, queuedOnly: true };
  }
  try {
    const ok = writer.write(safeStringify(entry) + '\n');
    if (!ok) state.needsDrain = true;
    return state;
  } catch (err) {
    return { ...state, err };
  }
}

// Race end() against a destroy-timer. Exported for testing the timeout
// branch without waiting for a real Windows AV scanner to hang end().
export function raceEndAgainstDestroy(writer, timeoutMs) {
  return Promise.race([
    new Promise(resolve => { writer.end(resolve); }),
    new Promise(resolve => setTimeout(() => {
      try { writer.destroy(); } catch (_) {} resolve();
    }, timeoutMs))
  ]);
}

// Canonical per-snapshot bucket key. Must match discovery.js's equality
// check (testCase + name). Returns null for non-snapshot entries.
export function snapshotKey(meta) {
  const s = meta?.snapshot;
  if (!s || s.name == null) return null;
  return `${s.testCase ?? ''} ${s.name}`;
}

// Best-effort sweep of abandoned spill directories from prior crashed runs.
let swept = false;
export async function sweepOrphans(tmpdir = os.tmpdir(), now) {
  if (swept) return { removed: 0, bytes: 0, skipped: true };
  swept = true;
  if (now == null) now = Date.now();

  let removed = 0;
  let bytes = 0;
  let entries;
  try { entries = await fsp.readdir(tmpdir, { withFileTypes: true }); } catch (_) { return { removed: 0, bytes: 0 }; }

  const myUid = !IS_WINDOWS && typeof process.getuid === 'function'
    ? process.getuid() : null;

  for (const de of entries) {
    if (!de.isDirectory() || !de.name.startsWith(DIR_PREFIX)) continue;
    const full = path.join(tmpdir, de.name);
    try {
      const st = await fsp.stat(full);
      if (myUid !== null && st.uid !== myUid) continue;
      if (await isPidAlive(full)) continue;
      if (now - st.mtimeMs < ORPHAN_TTL_MS) continue;

      const sz = await dirSize(full);
      await fsp.rm(full, {
        recursive: true, force: true, maxRetries: 3, retryDelay: 100
      });
      removed++;
      bytes += sz;
    } catch (_) { /* permission / race / vanished */ }
  }
  return { removed, bytes };
}

export function __resetOrphanGuard() { swept = false; }

async function isPidAlive(dir) {
  try {
    const raw = await fsp.readFile(path.join(dir, 'pid'), 'utf8');
    const pid = parseInt(raw.trim(), 10);
    if (!Number.isInteger(pid) || pid <= 0) return false;
    try {
      process.kill(pid, 0);
      return true;
    } catch (e) {
      if (e.code === 'EPERM') return true;
      return false;
    }
  } catch (_) {
    return false;
  }
}

async function dirSize(p) {
  let total = 0;
  try {
    for (const de of await fsp.readdir(p, { withFileTypes: true })) {
      const full = path.join(p, de.name);
      if (de.isDirectory()) total += await dirSize(full);
      else {
        try { const s = await fsp.stat(full); total += s.size; } catch (_) {}
      }
    }
  } catch (_) {}
  return total;
}
