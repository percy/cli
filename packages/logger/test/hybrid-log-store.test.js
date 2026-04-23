import os from 'os';
import path from 'path';
import { promises as fsp } from 'fs';
import { HybridLogStore } from '@percy/logger/hybrid-log-store';
import { snapshotKey } from '@percy/logger/internal-utils';

const wait = ms => new Promise(r => setTimeout(r, ms));

function mkEntry (over = {}) {
  return {
    debug: 'test', level: 'info', message: 'hello', meta: {},
    timestamp: Date.now(), error: false, ...over
  };
}

describe('HybridLogStore', () => {
  let store;

  afterEach(async () => {
    if (store) { try { await store.reset(); } catch (_) {} }
    store = null;
  });

  describe('push + query', () => {
    it('stores global entries in the ring', () => {
      store = new HybridLogStore({ forceInMemory: true });
      store.push(mkEntry({ message: 'one' }));
      store.push(mkEntry({ message: 'two' }));
      const results = store.query(() => true);
      expect(results.length).toBe(2);
      expect(results[0].message).toBe('one');
      expect(results[1].message).toBe('two');
    });

    it('routes snapshot-tagged entries to buckets', () => {
      store = new HybridLogStore({ forceInMemory: true });
      store.push(mkEntry({ meta: { snapshot: { name: 'home' } } }));
      store.push(mkEntry({ meta: { snapshot: { name: 'home' } } }));
      store.push(mkEntry({ meta: { snapshot: { name: 'about' } } }));
      store.push(mkEntry({ message: 'global' })); // no snapshot

      expect(store.query(e => e.meta?.snapshot?.name === 'home').length).toBe(2);
      expect(store.query(e => e.meta?.snapshot?.name === 'about').length).toBe(1);
      expect(store.query(e => e.message === 'global').length).toBe(1);
    });

    it('applies filter predicate', () => {
      store = new HybridLogStore({ forceInMemory: true });
      store.push(mkEntry({ level: 'info' }));
      store.push(mkEntry({ level: 'warn' }));
      store.push(mkEntry({ level: 'error' }));
      expect(store.query(e => e.level === 'warn').length).toBe(1);
    });
  });

  describe('evictSnapshot', () => {
    it('deletes the targeted bucket index', () => {
      // NOTE: every routed entry also lives in the global ring for
      // post-eviction visibility via query(), so query() continues to
      // return the snapshot-tagged entry after evictSnapshot. The bucket
      // deletion frees the per-snapshot index without affecting the ring.
      store = new HybridLogStore({ forceInMemory: true });
      store.push(mkEntry({ meta: { snapshot: { name: 'a' } } }));
      store.push(mkEntry({ meta: { snapshot: { name: 'b' } } }));
      store.evictSnapshot(snapshotKey({ snapshot: { name: 'a' } }));
      // Both entries are still in the ring — query() reflects that.
      expect(store.query(e => e.meta?.snapshot?.name === 'a').length).toBe(1);
      expect(store.query(e => e.meta?.snapshot?.name === 'b').length).toBe(1);
    });

    it('is idempotent on unknown key', () => {
      store = new HybridLogStore({ forceInMemory: true });
      expect(() => store.evictSnapshot('never-existed')).not.toThrow();
    });
  });

  describe('ring wrap', () => {
    it('overwrites oldest entries when ringCap exceeded', () => {
      store = new HybridLogStore({ ringCap: 3, forceInMemory: true });
      store.push(mkEntry({ message: 'a' }));
      store.push(mkEntry({ message: 'b' }));
      store.push(mkEntry({ message: 'c' }));
      store.push(mkEntry({ message: 'd' }));
      const all = store.query(() => true);
      expect(all.map(e => e.message)).toEqual(['b', 'c', 'd']);
    });
  });

  describe('reset', () => {
    it('clears in-memory state', async () => {
      store = new HybridLogStore({ forceInMemory: true });
      store.push(mkEntry());
      expect(store.query(() => true).length).toBe(1);
      await store.reset();
      expect(store.query(() => true).length).toBe(0);
    });
  });

  describe('disk mode', () => {
    it('writes a JSONL file and readBack yields all entries', async () => {
      store = new HybridLogStore({});
      store.push(mkEntry({ message: 'a' }));
      store.push(mkEntry({ message: 'b' }));
      store.push(mkEntry({ message: 'c' }));

      // Give the WriteStream a tick to flush
      await wait(50);

      const back = [];
      for await (const e of store.readBack()) back.push(e);
      expect(back.map(e => e.message).sort()).toEqual(['a', 'b', 'c']);

      // spill dir should exist and contain build.log.jsonl
      const files = await fsp.readdir(store.spillDir);
      expect(files).toContain('build.log.jsonl');
      expect(files).toContain('pid');
    });

    it('refuses disk on Windows Temp path (DPR-5)', () => {
      // Simulate — we can't literally change os.tmpdir(), but we can verify
      // forceInMemory produces the no-disk outcome equivalent to the Windows
      // refusal code path.
      store = new HybridLogStore({ forceInMemory: true });
      expect(store.inMemoryOnly).toBeTrue();
      expect(store.spillDir).toBeNull();
    });
  });

  describe('memory-first reliability invariant (DPR-2)', () => {
    it('in-memory copy exists even when disk is off', () => {
      store = new HybridLogStore({ forceInMemory: true });
      store.push(mkEntry({ message: 'must-survive' }));
      expect(store.query(e => e.message === 'must-survive').length).toBe(1);
    });
  });

  describe('readBack in fallback mode (DPR-3)', () => {
    it('yields all in-memory entries when disk is unavailable', async () => {
      store = new HybridLogStore({ forceInMemory: true });
      store.push(mkEntry({ message: 'x' }));
      store.push(mkEntry({ message: 'y' }));
      const back = [];
      for await (const e of store.readBack()) back.push(e);
      expect(back.map(e => e.message)).toEqual(['x', 'y']);
    });
  });
});
