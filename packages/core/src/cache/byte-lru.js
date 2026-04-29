// Two-tier cache used by asset discovery:
//   ByteLRU — byte-budget in-memory LRU; Map insertion order = LRU order.
//   DiskSpillStore — on-disk overflow tier. RAM evictions spill here; lookups
//   fall back to disk before refetching from origin.
// All operations are synchronous; callers (network intercept, ByteLRU.set)
// cannot yield to the event loop mid-op. Per-entry size is capped at 25MB
// upstream so disk I/O latency is bounded.

import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';

const DEFAULT_PER_ENTRY_OVERHEAD = 512;

export class ByteLRU {
  #map = new Map();
  #bytes = 0;
  #max;
  #stats = { hits: 0, misses: 0, evictions: 0, peakBytes: 0 };
  onEvict;

  constructor(maxBytes, { onEvict } = {}) {
    this.#max = maxBytes;
    this.onEvict = onEvict;
  }

  get(key) {
    if (!this.#map.has(key)) {
      this.#stats.misses++;
      return undefined;
    }
    const rec = this.#map.get(key);
    this.#map.delete(key);
    this.#map.set(key, rec);
    this.#stats.hits++;
    return rec.value;
  }

  set(key, value, size) {
    if (!Number.isFinite(size) || size < 0) return false;

    // Reject oversize BEFORE touching any existing entry — a failed set on an
    // existing key must not evict the prior (valid) entry.
    if (this.#max !== undefined && size > this.#max) {
      if (this.onEvict) this.onEvict(key, 'too-big', value);
      return false;
    }

    if (this.#map.has(key)) {
      this.#bytes -= this.#map.get(key).size;
      this.#map.delete(key);
    }

    this.#map.set(key, { value, size });
    this.#bytes += size;
    if (this.#bytes > this.#stats.peakBytes) this.#stats.peakBytes = this.#bytes;

    while (this.#max !== undefined && this.#bytes > this.#max) {
      const oldestKey = this.#map.keys().next().value;
      const rec = this.#map.get(oldestKey);
      this.#bytes -= rec.size;
      this.#map.delete(oldestKey);
      this.#stats.evictions++;
      if (this.onEvict) this.onEvict(oldestKey, 'lru', rec.value);
    }

    return true;
  }

  has(key) { return this.#map.has(key); }

  delete(key) {
    if (!this.#map.has(key)) return false;
    this.#bytes -= this.#map.get(key).size;
    return this.#map.delete(key);
  }

  clear() {
    this.#map.clear();
    this.#bytes = 0;
  }

  get size() { return this.#map.size; }
  get calculatedSize() { return this.#bytes; }
  get stats() { return { ...this.#stats, currentBytes: this.#bytes }; }
}

// Handles the two Percy cache-entry shapes: single resource, or array of
// roots captured at multiple widths (see discovery.js parseDomResources).
export function entrySize(resource, overhead = DEFAULT_PER_ENTRY_OVERHEAD) {
  if (Array.isArray(resource)) {
    return resource.reduce((n, r) => n + (r?.content?.length ?? 0) + overhead, 0);
  }
  return (resource?.content?.length ?? 0) + overhead;
}

export class DiskSpillStore {
  #index = new Map();
  #bytes = 0;
  #peakBytes = 0;
  #stats = { spilled: 0, restored: 0, spillFailures: 0, readFailures: 0 };
  #counter = 0;
  #ready = false;

  constructor(dir, { log } = {}) {
    this.dir = dir;
    this.log = log;
    try {
      // mode 0o700: spilled bytes are origin-fetchable so the threat model is
      // small, but on shared-tenant CI hosts other users on the same box
      // shouldn't be able to read them.
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      this.#ready = true;
    } catch (err) {
      this.log?.debug?.(`disk-spill init failed for ${dir}: ${err.message}`);
    }
  }

  // Returns true on success; false on any failure so caller falls back to drop.
  // Overwrites prior spill for the same URL — a fresh discovery write wins.
  set(url, resource) {
    if (!this.#ready) return false;

    let content = resource?.content;
    if (content == null) return false;
    if (!Buffer.isBuffer(content)) {
      try { content = Buffer.from(content); } catch { return false; }
    }

    // Counter-based filename keeps URL-derived data out of path.join —
    // avoids any path-traversal surface even though sha256 would be safe.
    const filepath = path.join(this.dir, String(++this.#counter));

    try {
      fs.writeFileSync(filepath, content);
    } catch (err) {
      this.#stats.spillFailures++;
      this.log?.debug?.(`disk-spill write failed for ${url}: ${err.message}`);
      return false;
    }

    if (this.#index.has(url)) {
      const prev = this.#index.get(url);
      this.#bytes -= prev.size;
      try { fs.unlinkSync(prev.path); } catch { /* best-effort */ }
    }

    const meta = { ...resource };
    delete meta.content;
    this.#index.set(url, { path: filepath, size: content.length, meta });
    this.#bytes += content.length;
    if (this.#bytes > this.#peakBytes) this.#peakBytes = this.#bytes;
    this.#stats.spilled++;
    return true;
  }

  get(url) {
    const entry = this.#index.get(url);
    if (!entry) return undefined;
    let content;
    try {
      content = fs.readFileSync(entry.path);
    } catch (err) {
      this.#stats.readFailures++;
      this.log?.debug?.(`disk-spill read failed for ${url}: ${err.message}`);
      this.#removeEntry(url, entry);
      return undefined;
    }
    this.#stats.restored++;
    return { ...entry.meta, content };
  }

  has(url) { return this.#index.has(url); }

  delete(url) {
    const entry = this.#index.get(url);
    if (!entry) return false;
    this.#removeEntry(url, entry);
    return true;
  }

  destroy() {
    try {
      if (this.#ready) fs.rmSync(this.dir, { recursive: true, force: true });
    } catch (err) {
      this.log?.debug?.(`disk-spill cleanup failed for ${this.dir}: ${err.message}`);
    }
    this.#index.clear();
    this.#bytes = 0;
    this.#ready = false;
  }

  get size() { return this.#index.size; }
  get bytes() { return this.#bytes; }
  get ready() { return this.#ready; }
  get stats() {
    return {
      ...this.#stats,
      currentBytes: this.#bytes,
      peakBytes: this.#peakBytes,
      entries: this.#index.size
    };
  }

  #removeEntry(url, entry) {
    this.#bytes -= entry.size;
    this.#index.delete(url);
    try { fs.unlinkSync(entry.path); } catch { /* best-effort */ }
  }
}

export function createSpillDir() {
  const suffix = `${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
  return path.join(os.tmpdir(), `percy-cache-${suffix}`);
}
