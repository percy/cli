import { ByteLRU, entrySize } from '../../src/cache/byte-lru.js';

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

    it('onEvict fires with reason "too-big" on oversize', () => {
      const reasons = [];
      const c = new ByteLRU(100, { onEvict: (k, r) => reasons.push({ k, r }) });
      c.set('huge', 'HUGE', 200);
      expect(reasons).toEqual([{ k: 'huge', r: 'too-big' }]);
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

  describe('.values()', () => {
    it('iterates yielding plain values (Percy discovery.test.js call-site shape)', () => {
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
  });

  describe('stats', () => {
    it('peakBytes captures transient high-water before eviction (honest reporting)', () => {
      const c = new ByteLRU(300);
      c.set('a', 'A', 100);
      c.set('b', 'B', 100);
      c.set('c', 'C', 100);
      c.set('d', 'D', 100); // transient 400, then evict → 300
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

  it('accepts custom overhead', () => {
    expect(entrySize({ content: Buffer.alloc(100) }, 0)).toEqual(100);
  });
});
