// Hand-rolled byte-budget LRU cache. Map insertion order is LRU order;
// .get() deletes and re-sets to move an entry to MRU. Synchronous by design —
// no logger calls, no awaits inside mutation paths, so callers can log
// after .set() returns without risking a mid-state event-loop yield.

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

    // Reject oversize BEFORE touching any existing entry — a failed oversize
    // set on an existing key must not evict the prior (valid) entry.
    if (this.#max !== undefined && size > this.#max) {
      if (this.onEvict) this.onEvict(key, 'too-big');
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
      if (this.onEvict) this.onEvict(oldestKey, 'lru');
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

  values() {
    const iter = this.#map.values();
    return {
      next: () => {
        const r = iter.next();
        return r.done ? r : { value: r.value.value, done: false };
      },
      [Symbol.iterator]() { return this; }
    };
  }

  get size() { return this.#map.size; }
  get calculatedSize() { return this.#bytes; }
  get stats() { return { ...this.#stats, currentBytes: this.#bytes }; }
}

// Compute the byte size attributable to a cache entry. Handles the two Percy
// shapes: a single resource object, or an array of resources (root-resource
// captured at multiple widths per discovery.js:465).
export function entrySize(resource, overhead = DEFAULT_PER_ENTRY_OVERHEAD) {
  if (Array.isArray(resource)) {
    return resource.reduce((n, r) => n + (r?.content?.length ?? 0) + overhead, 0);
  }
  return (resource?.content?.length ?? 0) + overhead;
}
