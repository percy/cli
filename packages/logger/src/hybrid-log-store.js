// HybridLogStore — bounded-memory, disk-backed log storage for @percy/logger.
//
// See docs/plans/2026-04-23-001-feat-disk-backed-hybrid-log-store-plan.md.
//
// Storage model:
//   - Every entry is written to disk (append-only JSONL) AS WELL AS routed
//     to an in-memory cache. Disk is the source of truth for `readBack()`;
//     memory is only for fast synchronous `query()` during a live build.
//   - In-memory cache has two zones:
//       * global ring buffer (bounded, evicts oldest on overflow) — holds
//         recent non-snapshot-tagged entries.
//       * per-snapshot Map<key, entries[]> — holds snapshot-tagged entries
//         while the snapshot is in-flight. Eviction is lifecycle-driven
//         (the snapshot queue's task/error handler calls `evictSnapshot`
//         after the POST completes), so memory stays bounded by
//         `concurrency × per-snapshot log volume` regardless of total build
//         size or `deferUploads` window depth.
//   - Backpressure is respected: if the WriteStream's internal buffer
//     exceeds MAX_STREAM_BUFFER OR `write()` returns false, disk writes are
//     paused until the stream drains. The in-memory copy is made first, so
//     no entry is ever lost to backpressure.
//   - On any disk failure (init probe, runtime write error), the store
//     transitions to `inMemoryOnly` mode. `readBack()` in that mode still
//     reads whatever made it to disk before the transition, then appends
//     entries whose timestamps post-date the last successful disk write —
//     so no entries are silently dropped from `sendBuildLogs()`.
//   - Exit handlers (process 'exit' / SIGINT / SIGTERM) delete the spill
//     directory synchronously on normal shutdown, shrinking the
//     secret-at-rest window from the 24 h orphan TTL to "process lifetime".

import { promises as fsp, createWriteStream, createReadStream,
         mkdtempSync, chmodSync, writeFileSync, unlinkSync,
         rmSync } from 'fs';
import { createInterface } from 'readline';
import os from 'os';
import path from 'path';

import { safeStringify, sanitizeMeta } from './safe-stringify.js';
import { snapshotKey } from './internal-utils.js';
import { DIR_PREFIX } from './orphan-cleanup.js';

const DEFAULT_RING_SIZE = Number(process.env.PERCY_LOG_RING_SIZE) || 2000;
const MAX_STREAM_BUFFER = 1 * 1024 * 1024; // 1 MB soft cap on WriteStream's internal buffer
const CLOSE_TIMEOUT_MS = 2000;
const IS_WINDOWS = process.platform === 'win32';

// Module-level store registry so process-wide exit handlers are registered
// exactly once, regardless of how many HybridLogStore instances the process
// creates (each test typically creates a fresh singleton after reset). Without
// this, Node hits MaxListeners=10 after ~4 test cases.
const activeStores = new Set();
let processHandlersRegistered = false;
function ensureProcessHandlers () {
  if (processHandlersRegistered) return;
  processHandlersRegistered = true;
  const syncAll = () => {
    for (const store of activeStores) store._syncCleanup();
  };
  process.on('exit', syncAll);
  const signalExit = () => { syncAll(); process.exit(130); };
  process.once('SIGINT', signalExit);
  process.once('SIGTERM', signalExit);
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

  constructor ({ ringCap = DEFAULT_RING_SIZE, forceInMemory = false } = {}) {
    this.#ringCap = ringCap;
    this.#forcedInMemory = forceInMemory;
    this.#inMemoryOnly = forceInMemory;
    this.#ring = new Array(ringCap);
    if (!forceInMemory) this.#initDisk();
    activeStores.add(this);
    ensureProcessHandlers();
  }

  // ── public API ────────────────────────────────────────────────────

  // RELIABILITY INVARIANT: memory first, disk second. Any entry that enters
  // push() is at least in the in-memory cache, even if an async WriteStream
  // error fires between write() and the handler.
  //
  // SECURITY INVARIANT: the entry is sanitized in place BEFORE routing so
  // the in-memory cache never holds unredacted strings. This makes DPR-6
  // (redact-on-write) end-to-end — query() and toArray() can never expose
  // a raw secret, matching the on-disk JSONL's contents.
  push (entry) {
    // Round-trip through safeReplacer for deep redaction of all string
    // values anywhere in the entry (message, meta.*). sanitizeMeta's
    // JSON round-trip drops non-serializable values (Function, Symbol)
    // and encodes Buffer/Error/BigInt in their serializable forms.
    const sanitized = sanitizeMeta(entry) || entry;
    this.#routeInMemory(sanitized);
    this.#writeDisk(sanitized);
  }

  query (filter) {
    // Ring holds every routed entry (including snapshot-tagged entries;
    // routeInMemory appends to both ring AND bucket). Buckets are an
    // eviction index, not a query source — iterating them here would
    // double-count. The ring's bounded size means very old entries age
    // out of memory for query(), but they remain on disk for readBack().
    const results = [];
    for (let i = 0; i < this.#ringSize; i++) {
      const idx = (this.#ringHead - this.#ringSize + i + this.#ringCap) % this.#ringCap;
      const e = this.#ring[idx];
      if (filter(e)) results.push(e);
    }
    return results;
  }

  evictSnapshot (key) {
    if (key != null) this.#buckets.delete(key);
  }

  // Sync in-memory clear. Does NOT touch the disk writer or spill directory,
  // so it is safe to call on a hot logger without closing-and-reopening the
  // writer. Intended for test-endpoint resets that want to discard prior
  // log entries but keep the instance running.
  clearMemory () {
    this.#ring = new Array(this.#ringCap);
    this.#ringHead = 0;
    this.#ringSize = 0;
    this.#buckets.clear();
  }

  // Async iterator over every persisted entry. Reads disk first; in fallback
  // mode, appends in-memory entries whose timestamps post-date the last
  // successfully flushed disk entry. Guarantees no silent data loss when the
  // store transitioned to inMemoryOnly mid-build.
  async * readBack () {
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
          } catch (_) { /* malformed tail (crash-truncated) — skip */ }
        }
      } catch (_) {
        // disk read failed (systemd-tmpfiles unlinked, EACCES after
        // permissions change, tmpdir unmounted) — fall through to memory.
        diskFailed = true;
      }
    }
    // Fall back to in-memory under any of: no spill path, in-memory mode
    // (store transitioned mid-build), or disk read failed (DPR-20 —
    // unlinked spill file). In the fallback cases we yield EVERY memory
    // entry to avoid dropping pre-failure entries; in the normal case
    // (disk read succeeded) we skip memory since disk is a superset.
    const shouldYieldMemory = this.#inMemoryOnly ||
                              !this.#spillFilePath ||
                              diskFailed ||
                              !diskYielded;
    if (shouldYieldMemory) {
      for (const e of this.query(() => true)) {
        if (typeof e.timestamp !== 'number' || e.timestamp > lastTs) yield e;
      }
    }
  }

  async reset () {
    this.#ring = new Array(this.#ringCap);
    this.#ringHead = 0;
    this.#ringSize = 0;
    this.#buckets.clear();
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

  // Terminal teardown — closes the writer, removes the spill directory,
  // clears in-memory state, and deregisters from the process-exit registry.
  // Unlike reset(), does NOT re-initialize the disk store, so the instance
  // is no longer usable after dispose. Intended for test teardown where the
  // singleton is about to be replaced.
  async dispose () {
    this.#ring = new Array(this.#ringCap);
    this.#ringHead = 0;
    this.#ringSize = 0;
    this.#buckets.clear();
    this.#needsDrain = false;
    this.#lastDiskTimestamp = 0;

    await this.#closeWriter();
    await this.#cleanupSpillDir();
    this.#spillDir = null;
    this.#spillFilePath = null;
    this.#inMemoryOnly = true;
    activeStores.delete(this);
  }

  get inMemoryOnly () { return this.#inMemoryOnly; }
  get spillDir () { return this.#spillDir; }

  // ── internals ─────────────────────────────────────────────────────

  #routeInMemory (entry) {
    // Every entry lands in the ring for post-eviction visibility via query().
    // Snapshot-tagged entries are ALSO indexed by key so discovery.js:220's
    // per-snapshot filter stays O(bucket) during the snapshot's in-flight
    // window. Once the snapshot's bucket is evicted, the ring still serves
    // stale queries up to its capacity, which matches pre-refactor
    // behavior where the unbounded Set kept everything.
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

  #initDisk () {
    try {
      const tmp = os.tmpdir();
      // Windows shared-runner safety: refuse C:\Windows\Temp (world-readable
      // on some CI flavors). Force in-memory with a one-shot warning.
      if (IS_WINDOWS && /^[A-Z]:\\Windows\\Temp$/i.test(tmp)) {
        throw Object.assign(
          new Error('tmpdir not user-scoped on Windows; refusing to spill'),
          { code: 'PERCY_UNSAFE_TMPDIR' }
        );
      }

      // mkdtempSync generates a collision-free suffix — ~128 bits of entropy
      // and atomic create-or-fail. Prevents symlink squat on predictable
      // pid+rand names.
      const dir = mkdtempSync(path.join(tmp, DIR_PREFIX));

      // POSIX belt-and-braces vs umask. No-op on Windows.
      if (!IS_WINDOWS) { try { chmodSync(dir, 0o700); } catch (_) {} }

      // Probe: can we write a file?
      const probe = path.join(dir, '.probe');
      writeFileSync(probe, '');
      unlinkSync(probe);

      // PID file for orphan sweep: if the process is still live on the
      // next invocation's sweep, the dir is skipped regardless of mtime.
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

  #writeDisk (entry) {
    if (this.#inMemoryOnly || !this.#writer) return;

    // Backpressure gate: if the stream is already over the soft cap, queue
    // for memory-only until it drains. The in-memory copy already exists
    // (push() routed to memory first).
    if (this.#needsDrain || this.#writer.writableLength > MAX_STREAM_BUFFER) {
      this.#needsDrain = true;
      return;
    }
    try {
      const serialized = safeStringify(entry);
      const ok = this.#writer.write(serialized + '\n');
      if (!ok) this.#needsDrain = true;
      if (typeof entry.timestamp === 'number' && entry.timestamp > this.#lastDiskTimestamp) {
        this.#lastDiskTimestamp = entry.timestamp;
      }
    } catch (err) {
      this.#transitionToMemory(err);
    }
  }

  #transitionToMemory (err) {
    if (this.#inMemoryOnly) return;
    this.#inMemoryOnly = true;
    this.lastFallbackError = err;
    // Don't unlink the spill file — readBack() still reads what's there.
    this.#closeWriter().catch(() => {});
  }

  // Close with a hard timeout. On Windows, AV scanners can hang end().
  async #closeWriter () {
    const w = this.#writer;
    this.#writer = null;
    if (!w) return;
    await Promise.race([
      new Promise(resolve => { w.end(resolve); }),
      new Promise(resolve => setTimeout(() => { try { w.destroy(); } catch (_) {} resolve(); }, CLOSE_TIMEOUT_MS))
    ]);
  }

  async #cleanupSpillDir () {
    if (!this.#spillDir) return;
    try {
      await fsp.rm(this.#spillDir, {
        recursive: true, force: true, maxRetries: 3, retryDelay: 100
      });
    } catch (_) {}
  }

  // Sync cleanup invoked by the module-level process handlers on exit or
  // signals. Never throws. Exposed (underscore-prefixed) for the registry
  // to call, not intended as public API.
  _syncCleanup () {
    try { if (this.#writer) this.#writer.end(); } catch (_) {}
    try {
      if (this.#spillDir) {
        rmSync(this.#spillDir, { recursive: true, force: true, maxRetries: 3 });
      }
    } catch (_) {}
  }
}
