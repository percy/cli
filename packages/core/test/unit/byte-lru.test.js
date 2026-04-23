import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  ByteLRU,
  entrySize,
  DiskSpillStore,
  createSpillDir
} from '../../src/cache/byte-lru.js';
import { DISK_SPILL_KEY, lookupCacheResource } from '../../src/discovery.js';

describe('Unit / ByteLRU', () => {
  describe('unbounded mode (no cap)', () => {
    it('behaves like a Map', () => {
      const c = new ByteLRU();
      c.set('a', { body: 'A' }, 100);
      c.set('b', { body: 'B' }, 200);
      expect(c.size).toEqual(2);
      expect(c.get('a')).toEqual({ body: 'A' });
      expect(c.calculatedSize).toEqual(300);
    });
  });

  describe('eviction', () => {
    it('evicts LRU when adding over-budget entry', () => {
      const c = new ByteLRU(300);
      c.set('a', 'A', 100);
      c.set('b', 'B', 100);
      c.set('c', 'C', 100);
      c.set('d', 'D', 100);
      expect(c.has('a')).toBe(false);
      expect(c.has('d')).toBe(true);
      expect(c.calculatedSize).toEqual(300);
    });

    it('evicts multiple entries if new one needs room', () => {
      const c = new ByteLRU(500);
      c.set('a', 'A', 100);
      c.set('b', 'B', 100);
      c.set('c', 'C', 100);
      c.set('d', 'D', 100);
      c.set('e', 'E', 100);
      c.set('big', 'BIG', 300);
      expect(c.has('a')).toBe(false);
      expect(c.has('b')).toBe(false);
      expect(c.has('c')).toBe(false);
      expect(c.has('d')).toBe(true);
      expect(c.has('e')).toBe(true);
      expect(c.has('big')).toBe(true);
      expect(c.calculatedSize).toEqual(500);
    });
  });

  describe('recency', () => {
    it('.get() bumps recency', () => {
      const c = new ByteLRU(300);
      c.set('a', 'A', 100);
      c.set('b', 'B', 100);
      c.set('c', 'C', 100);
      c.get('a');
      c.set('d', 'D', 100);
      expect(c.has('a')).toBe(true);
      expect(c.has('b')).toBe(false);
    });

    it('re-set same key updates size & recency', () => {
      const c = new ByteLRU(500);
      c.set('a', 'A1', 100);
      c.set('b', 'B', 100);
      c.set('a', 'A2', 200);
      expect(c.get('a')).toEqual('A2');
      expect(c.calculatedSize).toEqual(300);
    });
  });

  describe('oversized entry', () => {
    it('is skipped; cache unaffected', () => {
      const c = new ByteLRU(100);
      c.set('a', 'A', 50);
      const ok = c.set('huge', 'HUGE', 200);
      expect(ok).toBe(false);
      expect(c.has('huge')).toBe(false);
      expect(c.has('a')).toBe(true);
      expect(c.calculatedSize).toEqual(50);
    });

    it('oversized re-set of an existing key leaves the prior entry intact', () => {
      const c = new ByteLRU(100);
      c.set('k', 'small', 50);
      const ok = c.set('k', 'huge', 200);
      expect(ok).toBe(false);
      expect(c.has('k')).toBe(true);
      expect(c.get('k')).toEqual('small');
      expect(c.calculatedSize).toEqual(50);
    });
  });

  describe('onEvict', () => {
    it('fires with reason "too-big" and the value on oversize', () => {
      const evicted = [];
      const c = new ByteLRU(100, {
        onEvict: (k, r, v) => evicted.push({ k, r, v })
      });
      c.set('huge', { body: 'HUGE' }, 200);
      expect(evicted).toEqual([{ k: 'huge', r: 'too-big', v: { body: 'HUGE' } }]);
    });

    it('fires with reason "lru" and the evicted value when over budget', () => {
      const evicted = [];
      const c = new ByteLRU(200, {
        onEvict: (k, r, v) => evicted.push({ k, r, v })
      });
      c.set('a', { body: 'A' }, 100);
      c.set('b', { body: 'B' }, 100);
      c.set('c', { body: 'C' }, 100);
      expect(evicted).toEqual([{ k: 'a', r: 'lru', v: { body: 'A' } }]);
    });
  });

  describe('.values()', () => {
    it('iterates yielding plain values', () => {
      const c = new ByteLRU();
      c.set('a', { root: true }, 100);
      c.set('b', { root: false }, 100);
      c.set('c', { root: true }, 100);
      const rootResources = Array.from(c.values()).filter(r => !!r.root);
      expect(rootResources.length).toEqual(2);
    });
  });

  describe('.clear()', () => {
    it('resets bytes and map', () => {
      const c = new ByteLRU(1000);
      c.set('a', 'A', 100);
      c.set('b', 'B', 200);
      c.clear();
      expect(c.size).toEqual(0);
      expect(c.calculatedSize).toEqual(0);
      expect(c.has('a')).toBe(false);
    });
  });

  describe('.delete()', () => {
    it('updates bytes correctly and prevents double-count on re-insert', () => {
      const c = new ByteLRU(1000);
      c.set('a', 'A', 100);
      c.set('b', 'B', 200);
      c.delete('a');
      expect(c.has('a')).toBe(false);
      expect(c.calculatedSize).toEqual(200);
      c.set('a', 'A', 100);
      expect(c.calculatedSize).toEqual(300);
    });

    it('returns false when the key is not in the cache', () => {
      const c = new ByteLRU(1000);
      c.set('a', 'A', 100);
      expect(c.delete('missing')).toBe(false);
      expect(c.calculatedSize).toEqual(100);
    });
  });

  describe('stats', () => {
    it('peakBytes captures transient high-water before eviction', () => {
      const c = new ByteLRU(300);
      c.set('a', 'A', 100);
      c.set('b', 'B', 100);
      c.set('c', 'C', 100);
      c.set('d', 'D', 100);
      c.delete('b');
      c.delete('c');
      c.delete('d');
      expect(c.calculatedSize).toEqual(0);
      expect(c.stats.peakBytes).toEqual(400);
    });

    it('tracks hits / misses / evictions', () => {
      const c = new ByteLRU(300);
      c.set('a', 'A', 100);
      c.set('b', 'B', 100);
      c.get('a'); c.get('a'); c.get('missing');
      c.set('c', 'C', 100);
      c.set('d', 'D', 100);
      const s = c.stats;
      expect(s.hits).toEqual(2);
      expect(s.misses).toEqual(1);
      expect(s.evictions).toBeGreaterThan(0);
      expect(s.currentBytes).toEqual(300);
    });
  });

  describe('sanity under alternating get/set', () => {
    it('calculated bytes stay consistent across heavy churn', () => {
      const c = new ByteLRU(1000);
      for (let i = 0; i < 100; i++) c.set(`k${i}`, i, 10);
      expect(c.calculatedSize).toEqual(1000);
      for (let i = 0; i < 100; i++) c.get(`k${i}`);
      for (let i = 0; i < 50; i++) c.set(`n${i}`, i, 20);
      expect(c.calculatedSize).toEqual(1000);
      for (let i = 0; i < 50; i++) expect(c.has(`n${i}`)).toBe(true);
      for (let i = 0; i < 100; i++) expect(c.has(`k${i}`)).toBe(false);
    });
  });

  describe('input guards', () => {
    it('refuses NaN/negative sizes', () => {
      const c = new ByteLRU(1000);
      expect(c.set('a', 'A', NaN)).toBe(false);
      expect(c.set('b', 'B', -1)).toBe(false);
      expect(c.size).toEqual(0);
    });
  });
});

describe('Unit / entrySize', () => {
  it('sums content.length + overhead for a single resource', () => {
    const r = { content: Buffer.alloc(1000) };
    expect(entrySize(r)).toEqual(1000 + 512);
  });

  it('sums across array-valued root-resource-with-widths', () => {
    const arr = [
      { root: true, content: Buffer.alloc(100) },
      { root: true, content: Buffer.alloc(150) },
      { root: true, content: Buffer.alloc(200) }
    ];
    expect(entrySize(arr)).toEqual(450 + 3 * 512);
  });

  it('tolerates missing content field', () => {
    expect(entrySize({})).toEqual(512);
    expect(entrySize(null)).toEqual(512);
  });

  it('tolerates null entries and missing content fields inside an array', () => {
    const arr = [
      null,
      {},
      { content: Buffer.alloc(100) }
    ];
    expect(entrySize(arr)).toEqual(100 + 3 * 512);
  });

  it('accepts custom overhead', () => {
    expect(entrySize({ content: Buffer.alloc(100) }, 0)).toEqual(100);
  });
});

describe('Unit / DiskSpillStore', () => {
  function makeResource(url, content, extra = {}) {
    return {
      url,
      sha: 'deadbeef',
      mimetype: 'text/css',
      content: Buffer.isBuffer(content) ? content : Buffer.from(content),
      ...extra
    };
  }

  function makeLog() {
    const calls = [];
    return { calls, debug: (m) => calls.push(m) };
  }

  function freshDir() {
    return path.join(
      os.tmpdir(),
      `disk-spill-test-${process.pid}-${Math.random().toString(36).slice(2, 10)}`
    );
  }

  let dir;
  let store;

  afterEach(() => {
    store?.destroy();
    if (dir && fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  });

  describe('construction', () => {
    it('creates the target directory', () => {
      dir = freshDir();
      store = new DiskSpillStore(dir);
      expect(fs.existsSync(dir)).toBe(true);
      expect(store.ready).toBe(true);
    });

    it('swallows mkdir failure and marks itself not-ready', () => {
      const log = makeLog();
      store = new DiskSpillStore('/dev/null/cannot-mkdir-here', { log });
      expect(store.ready).toBe(false);
      expect(log.calls.some(m => m.includes('init failed'))).toBe(true);
    });

    it('short-circuits set() when not ready', () => {
      store = new DiskSpillStore('/dev/null/cannot-mkdir-here');
      expect(store.set('http://x/a', makeResource('http://x/a', 'A'))).toBe(false);
      expect(store.stats.spillFailures).toEqual(0);
    });

    it('works without a log option', () => {
      // Covers the optional-chain branches on this.log?.debug?.() calls.
      const badDir = '/dev/null/cannot-mkdir-here';
      const silent = new DiskSpillStore(badDir);
      expect(silent.ready).toBe(false);
      expect(silent.set('http://x/a', makeResource('http://x/a', 'A'))).toBe(false);
    });
  });

  describe('set + get round-trip', () => {
    beforeEach(() => {
      dir = freshDir();
      store = new DiskSpillStore(dir);
    });

    it('preserves binary content byte-for-byte', () => {
      const bin = Buffer.from([0, 1, 2, 253, 254, 255, 0, 127]);
      store.set('http://x/bin', makeResource('http://x/bin', bin, { mimetype: 'image/png' }));
      const got = store.get('http://x/bin');
      expect(got.content.equals(bin)).toBe(true);
      expect(got.mimetype).toEqual('image/png');
      expect(got.url).toEqual('http://x/bin');
    });

    it('coerces non-Buffer content via Buffer.from', () => {
      store.set('http://x/str', { url: 'http://x/str', mimetype: 'text/html', content: 'hello' });
      expect(store.get('http://x/str').content.toString()).toEqual('hello');
    });

    it('returns false when Buffer.from coercion throws', () => {
      // A symbol cannot be coerced to a Buffer.
      const badContent = Symbol('x');
      expect(store.set('http://x/bad', { content: badContent })).toBe(false);
    });

    it('returns undefined for unknown urls', () => {
      expect(store.get('http://x/missing')).toBeUndefined();
    });

    it('returns false when content is null/undefined', () => {
      expect(store.set('http://x/nil', { url: 'http://x/nil' })).toBe(false);
      expect(store.set('http://x/nil2', null)).toBe(false);
    });

    it('carries resource metadata through the round-trip', () => {
      store.set(
        'http://x/root',
        makeResource('http://x/root', 'root-html', { root: true, widths: [1280], sha: 'abc123' })
      );
      const got = store.get('http://x/root');
      expect(got.root).toBe(true);
      expect(got.widths).toEqual([1280]);
      expect(got.sha).toEqual('abc123');
    });

    it('increments spilled/restored counters', () => {
      store.set('http://x/a', makeResource('http://x/a', 'A'));
      store.set('http://x/b', makeResource('http://x/b', 'B'));
      store.get('http://x/a');
      store.get('http://x/a');
      store.get('http://x/missing');
      expect(store.stats.spilled).toEqual(2);
      expect(store.stats.restored).toEqual(2);
    });
  });

  describe('accounting', () => {
    beforeEach(() => {
      dir = freshDir();
      store = new DiskSpillStore(dir);
    });

    it('tracks bytes and peak', () => {
      store.set('http://x/a', makeResource('http://x/a', Buffer.alloc(1000)));
      store.set('http://x/b', makeResource('http://x/b', Buffer.alloc(2000)));
      expect(store.bytes).toEqual(3000);
      expect(store.stats.peakBytes).toEqual(3000);
      store.delete('http://x/a');
      expect(store.bytes).toEqual(2000);
      expect(store.stats.peakBytes).toEqual(3000);
    });

    it('replaces an existing URL and fixes up byte accounting', () => {
      store.set('http://x/a', makeResource('http://x/a', Buffer.alloc(1000)));
      store.set('http://x/a', makeResource('http://x/a', Buffer.alloc(500)));
      expect(store.bytes).toEqual(500);
      expect(store.size).toEqual(1);
      expect(store.get('http://x/a').content.length).toEqual(500);
    });

    it('silently tolerates unlinkSync errors during overwrite', () => {
      // Covers the best-effort unlink branch in the overwrite path.
      store.set('http://x/a', makeResource('http://x/a', 'A'));
      const spy = spyOn(fs, 'unlinkSync').and.throwError(new Error('EBUSY'));
      try {
        expect(() => store.set('http://x/a', makeResource('http://x/a', 'B'))).not.toThrow();
      } finally { spy.and.callThrough(); }
      expect(store.get('http://x/a').content.toString()).toEqual('B');
    });
  });

  describe('failure handling', () => {
    beforeEach(() => {
      dir = freshDir();
      store = new DiskSpillStore(dir);
    });

    it('returns false and increments spillFailures on write error', () => {
      const log = makeLog();
      const localStore = new DiskSpillStore(dir, { log });
      const spy = spyOn(fs, 'writeFileSync').and.throwError(new Error('EACCES'));
      try {
        const ok = localStore.set('http://x/a', makeResource('http://x/a', 'A'));
        expect(ok).toBe(false);
        expect(localStore.stats.spillFailures).toEqual(1);
        expect(log.calls.some(m => m.includes('write failed'))).toBe(true);
      } finally { spy.and.callThrough(); }
    });

    it('self-heals the index on read failure', () => {
      const log = makeLog();
      const localStore = new DiskSpillStore(dir, { log });
      localStore.set('http://x/a', makeResource('http://x/a', 'A'));
      expect(localStore.has('http://x/a')).toBe(true);

      const spy = spyOn(fs, 'readFileSync').and.throwError(new Error('ENOENT'));
      try {
        const got = localStore.get('http://x/a');
        expect(got).toBeUndefined();
        expect(localStore.has('http://x/a')).toBe(false);
        expect(localStore.stats.readFailures).toEqual(1);
        expect(log.calls.some(m => m.includes('read failed'))).toBe(true);
      } finally { spy.and.callThrough(); }
    });
  });

  describe('delete + destroy', () => {
    beforeEach(() => {
      dir = freshDir();
      store = new DiskSpillStore(dir);
    });

    it('delete removes both file and index entry, is idempotent', () => {
      store.set('http://x/a', makeResource('http://x/a', 'A'));
      expect(fs.readdirSync(dir).length).toEqual(1);
      expect(store.delete('http://x/a')).toBe(true);
      expect(fs.readdirSync(dir).length).toEqual(0);
      expect(store.has('http://x/a')).toBe(false);
      expect(store.delete('http://x/a')).toBe(false);
    });

    it('delete silently tolerates unlinkSync errors', () => {
      store.set('http://x/a', makeResource('http://x/a', 'A'));
      const spy = spyOn(fs, 'unlinkSync').and.throwError(new Error('EBUSY'));
      try {
        expect(() => store.delete('http://x/a')).not.toThrow();
      } finally { spy.and.callThrough(); }
    });

    it('destroy removes the entire dir and clears index', () => {
      store.set('http://x/a', makeResource('http://x/a', 'A'));
      store.set('http://x/b', makeResource('http://x/b', 'B'));
      store.destroy();
      expect(fs.existsSync(dir)).toBe(false);
      expect(store.size).toEqual(0);
      expect(store.ready).toBe(false);
    });

    it('destroy swallows rm errors', () => {
      const log = makeLog();
      const localStore = new DiskSpillStore(dir, { log });
      const spy = spyOn(fs, 'rmSync').and.throwError(new Error('EBUSY'));
      try {
        expect(() => localStore.destroy()).not.toThrow();
        expect(log.calls.some(m => m.includes('cleanup failed'))).toBe(true);
      } finally { spy.and.callThrough(); }
    });

    it('destroy is a no-op when the store was not ready', () => {
      const notReady = new DiskSpillStore('/dev/null/cannot-mkdir-here');
      const rmSpy = spyOn(fs, 'rmSync');
      try {
        notReady.destroy();
        expect(rmSpy).not.toHaveBeenCalled();
      } finally { rmSpy.and.callThrough(); }
    });
  });

  describe('createSpillDir', () => {
    it('returns a unique path under os.tmpdir() with a percy-cache prefix', () => {
      const a = createSpillDir();
      const b = createSpillDir();
      expect(a).not.toEqual(b);
      expect(a.startsWith(os.tmpdir())).toBe(true);
      expect(path.basename(a).startsWith('percy-cache-')).toBe(true);
    });
  });
});

describe('Unit / lookupCacheResource', () => {
  function makePercy(disk) {
    const logs = [];
    const percy = {
      log: { debug: (m) => logs.push(m) },
      [DISK_SPILL_KEY]: disk
    };
    return { percy, logs };
  }

  it('returns a snapshot-local resource first', () => {
    const { percy } = makePercy(undefined);
    const local = { url: 'a', mimetype: 'text/css', content: Buffer.from('L') };
    const snapshotResources = new Map([['a', local]]);
    const cache = new ByteLRU();
    expect(lookupCacheResource(percy, snapshotResources, cache, 'a')).toBe(local);
  });

  it('falls through to RAM cache when snapshot has no entry', () => {
    const { percy } = makePercy(undefined);
    const cache = new ByteLRU();
    const cached = { url: 'a', content: Buffer.from('C') };
    cache.set('a', cached, 100);
    expect(lookupCacheResource(percy, new Map(), cache, 'a')).toBe(cached);
  });

  it('falls through to disk when both snapshot and RAM miss', () => {
    const dir = path.join(os.tmpdir(), `lookup-test-${process.pid}-${Math.random().toString(36).slice(2, 8)}`);
    const disk = new DiskSpillStore(dir);
    try {
      disk.set('a', { url: 'a', mimetype: 'text/css', content: Buffer.from('DISK') });
      const { percy, logs } = makePercy(disk);
      const got = lookupCacheResource(percy, new Map(), new ByteLRU(), 'a');
      expect(got.content.toString()).toEqual('DISK');
      expect(logs.some(m => m.includes('cache disk-hit: a'))).toBe(true);
    } finally { disk.destroy(); }
  });

  it('returns undefined on full miss', () => {
    const { percy } = makePercy(undefined);
    expect(lookupCacheResource(percy, new Map(), new ByteLRU(), 'missing')).toBeUndefined();
  });

  it('returns undefined when disk is present but url is absent', () => {
    const dir = path.join(os.tmpdir(), `lookup-test-${process.pid}-${Math.random().toString(36).slice(2, 8)}`);
    const disk = new DiskSpillStore(dir);
    try {
      const { percy, logs } = makePercy(disk);
      expect(lookupCacheResource(percy, new Map(), new ByteLRU(), 'missing')).toBeUndefined();
      expect(logs.length).toEqual(0);
    } finally { disk.destroy(); }
  });

  it('picks the width-matching entry from an array-valued root resource', () => {
    const { percy } = makePercy(undefined);
    const arr = [
      { root: true, widths: [375], content: Buffer.from('small') },
      { root: true, widths: [1280], content: Buffer.from('wide') }
    ];
    const snapshotResources = new Map([['root', arr]]);
    const cache = new ByteLRU();
    const got = lookupCacheResource(percy, snapshotResources, cache, 'root', 1280);
    expect(got.content.toString()).toEqual('wide');
  });

  it('falls back to the first array entry when no width matches', () => {
    const { percy } = makePercy(undefined);
    const arr = [
      { root: true, widths: [375], content: Buffer.from('A') },
      { root: true, widths: [1280], content: Buffer.from('B') }
    ];
    const got = lookupCacheResource(percy, new Map([['root', arr]]), new ByteLRU(), 'root', 9999);
    expect(got.content.toString()).toEqual('A');
  });
});
