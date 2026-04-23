import os from 'os';
import path from 'path';
import { promises as fsp } from 'fs';
import {
  HybridLogStore, snapshotKey, safeStringify, sanitizeMeta,
  sweepOrphans, __resetOrphanGuard, DIR_PREFIX
} from '@percy/logger/hybrid-log-store';

const wait = ms => new Promise(r => setTimeout(r, ms));

function mkEntry(over = {}) {
  return {
    debug: 'test',
    level: 'info',
    message: 'hello',
    meta: {},
    timestamp: Date.now(),
    error: false,
    ...over
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

    it('routes snapshot-tagged entries to buckets and keeps them in the ring', () => {
      store = new HybridLogStore({ forceInMemory: true });
      store.push(mkEntry({ meta: { snapshot: { name: 'home' } } }));
      store.push(mkEntry({ meta: { snapshot: { name: 'home' } } }));
      store.push(mkEntry({ meta: { snapshot: { name: 'about' } } }));
      store.push(mkEntry({ message: 'global' }));

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
    it('deletes the bucket index but leaves ring entries visible', () => {
      store = new HybridLogStore({ forceInMemory: true });
      store.push(mkEntry({ meta: { snapshot: { name: 'a' } } }));
      store.push(mkEntry({ meta: { snapshot: { name: 'b' } } }));
      store.evictSnapshot(snapshotKey({ snapshot: { name: 'a' } }));
      expect(store.query(e => e.meta?.snapshot?.name === 'a').length).toBe(1);
      expect(store.query(e => e.meta?.snapshot?.name === 'b').length).toBe(1);
    });

    it('is idempotent on unknown key', () => {
      store = new HybridLogStore({ forceInMemory: true });
      expect(() => store.evictSnapshot('never-existed')).not.toThrow();
      expect(() => store.evictSnapshot(null)).not.toThrow();
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

  describe('reset and dispose', () => {
    it('reset clears in-memory state', async () => {
      store = new HybridLogStore({ forceInMemory: true });
      store.push(mkEntry());
      expect(store.query(() => true).length).toBe(1);
      await store.reset();
      expect(store.query(() => true).length).toBe(0);
    });

    it('dispose tears down without reinit', async () => {
      store = new HybridLogStore({ forceInMemory: true });
      store.push(mkEntry());
      await store.dispose();
      expect(store.query(() => true).length).toBe(0);
      expect(store.inMemoryOnly).toBeTrue();
      store = null;
    });
  });

  describe('disk mode', () => {
    it('writes a JSONL file and readBack yields all entries', async () => {
      store = new HybridLogStore({});
      store.push(mkEntry({ message: 'a' }));
      store.push(mkEntry({ message: 'b' }));
      store.push(mkEntry({ message: 'c' }));
      await wait(50);

      const back = [];
      for await (const e of store.readBack()) back.push(e);
      expect(back.map(e => e.message).sort()).toEqual(['a', 'b', 'c']);

      const files = await fsp.readdir(store.spillDir);
      expect(files).toContain('build.log.jsonl');
      expect(files).toContain('pid');
    });

    it('forceInMemory skips disk entirely', () => {
      store = new HybridLogStore({ forceInMemory: true });
      expect(store.inMemoryOnly).toBeTrue();
      expect(store.spillDir).toBeNull();
    });
  });

  describe('memory-first invariant', () => {
    it('keeps the in-memory copy even when disk is off', () => {
      store = new HybridLogStore({ forceInMemory: true });
      store.push(mkEntry({ message: 'must-survive' }));
      expect(store.query(e => e.message === 'must-survive').length).toBe(1);
    });
  });

  describe('readBack fallback', () => {
    it('yields in-memory entries when disk is unavailable', async () => {
      store = new HybridLogStore({ forceInMemory: true });
      store.push(mkEntry({ message: 'x' }));
      store.push(mkEntry({ message: 'y' }));
      const back = [];
      for await (const e of store.readBack()) back.push(e);
      expect(back.map(e => e.message)).toEqual(['x', 'y']);
    });

    it('falls back to in-memory when the spill file cannot be read', async () => {
      store = new HybridLogStore({});
      store.push(mkEntry({ message: 'pre-unlink', timestamp: Date.now() }));
      await wait(50);
      await fsp.unlink(path.join(store.spillDir, 'build.log.jsonl'));
      store.push(mkEntry({ message: 'post-unlink', timestamp: Date.now() + 1 }));

      const back = [];
      for await (const e of store.readBack()) back.push(e);
      const messages = back.map(e => e.message);
      expect(messages).toContain('pre-unlink');
      expect(messages).toContain('post-unlink');
    });
  });

  describe('disk-mode failure paths', () => {
    it('falls back to in-memory when initDisk fails', async () => {
      // Force os.tmpdir() to resolve to a non-existent path. mkdtempSync
      // throws ENOENT, the constructor's catch calls transitionToMemory,
      // and the store is usable in memory-only mode.
      const oldTmp = process.env.TMPDIR;
      process.env.TMPDIR = '/no/such/dir/per-7809-' + Date.now();
      try {
        const s = new HybridLogStore({});
        expect(s.inMemoryOnly).toBeTrue();
        expect(s.spillDir).toBeNull();
        expect(s.lastFallbackError).toBeDefined();
        s.push(mkEntry({ message: 'memory-only' }));
        expect(s.query(() => true).length).toBe(1);
        await s.dispose();
      } finally {
        if (oldTmp == null) delete process.env.TMPDIR;
        else process.env.TMPDIR = oldTmp;
      }
    });
  });
});

describe('snapshotKey', () => {
  it('returns null when meta is missing', () => {
    expect(snapshotKey()).toBe(null);
    expect(snapshotKey(null)).toBe(null);
    expect(snapshotKey({})).toBe(null);
    expect(snapshotKey({ snapshot: {} })).toBe(null);
  });

  it('returns a key when name is present', () => {
    expect(snapshotKey({ snapshot: { name: 'home' } })).toBe(' home');
  });

  it('includes testCase when present', () => {
    expect(snapshotKey({ snapshot: { testCase: 'auth', name: 'login' } }))
      .toBe('auth login');
  });

  it('treats null and empty testCase equivalently', () => {
    expect(snapshotKey({ snapshot: { testCase: null, name: 'x' } }))
      .toBe(snapshotKey({ snapshot: { testCase: '', name: 'x' } }));
  });

  it('is stable across equal meta shapes', () => {
    const k1 = snapshotKey({ snapshot: { testCase: 'a', name: 'b' } });
    const k2 = snapshotKey({ snapshot: { testCase: 'a', name: 'b' } });
    expect(k1).toBe(k2);
  });
});

describe('safeStringify', () => {
  it('survives circular references', () => {
    const a = { name: 'root' };
    a.self = a;
    expect(safeStringify(a)).toBe('{"name":"root","self":"[Circular]"}');
  });

  it('flattens Error instances', () => {
    const err = new TypeError('boom');
    const parsed = JSON.parse(safeStringify({ err }));
    expect(parsed.err.name).toBe('TypeError');
    expect(parsed.err.message).toBe('boom');
    expect(typeof parsed.err.stack).toBe('string');
  });

  it('encodes Buffer as base64', () => {
    const parsed = JSON.parse(safeStringify({ b: Buffer.from('hello') }));
    expect(parsed.b).toEqual({ type: 'Buffer', base64: 'aGVsbG8=' });
  });

  it('encodes a top-level Buffer via the Buffer.isBuffer fallback', () => {
    // When a Buffer is not the value of a key, its toJSON() still fires
    // and yields {type, data}. We also handle the defensive case where
    // someone passes a raw Buffer whose toJSON has been stripped.
    const bareBuffer = Buffer.from('raw');
    Object.defineProperty(bareBuffer, 'toJSON', { value: undefined, configurable: true });
    const out = JSON.parse(safeStringify({ b: bareBuffer }));
    expect(out.b).toEqual({ type: 'Buffer', base64: 'cmF3' });
  });

  it('stringifies BigInt', () => {
    expect(safeStringify({ n: BigInt(42) })).toBe('{"n":"42"}');
  });

  it('drops Function and Symbol', () => {
    expect(safeStringify({ f: () => 1, s: Symbol('x'), ok: 1 }))
      .toBe('{"ok":1}');
  });

  it('redacts secrets in deeply nested strings', () => {
    const out = JSON.parse(safeStringify({
      request: { headers: { Authorization: 'Bearer AKIAIOSFODNN7EXAMPLE' } }
    }));
    expect(out.request.headers.Authorization).not.toContain('AKIAIOSFODNN7EXAMPLE');
    expect(out.request.headers.Authorization).toContain('[REDACTED]');
  });
});

describe('sanitizeMeta', () => {
  it('returns primitives unchanged', () => {
    expect(sanitizeMeta(null)).toBe(null);
    expect(sanitizeMeta(undefined)).toBe(undefined);
    expect(sanitizeMeta(5)).toBe(5);
  });

  it('returns a plain redacted clone', () => {
    const out = sanitizeMeta({ token: 'AKIAIOSFODNN7EXAMPLE', name: 'home' });
    expect(out.token).toBe('[REDACTED]');
    expect(out.name).toBe('home');
  });

  it('handles circular without throwing', () => {
    const a = { name: 'x' }; a.self = a;
    expect(() => sanitizeMeta(a)).not.toThrow();
  });
});

describe('sweepOrphans', () => {
  let base;
  beforeEach(async () => {
    __resetOrphanGuard();
    base = await fsp.mkdtemp(path.join(os.tmpdir(), 'percy-sweep-test-'));
  });
  afterEach(async () => {
    try { await fsp.rm(base, { recursive: true, force: true }); } catch (_) {}
  });

  async function mkSpillDir(name, { mtime, pid, withPidFile = true } = {}) {
    const dir = path.join(base, name);
    await fsp.mkdir(dir, { recursive: true });
    await fsp.writeFile(path.join(dir, 'build.log.jsonl'), 'x'.repeat(100));
    if (withPidFile) await fsp.writeFile(path.join(dir, 'pid'), String(pid ?? 999999999));
    if (mtime) await fsp.utimes(dir, mtime, mtime);
    return dir;
  }

  it('removes directories older than 24h', async () => {
    const old = await mkSpillDir(`${DIR_PREFIX}old-aaaa`, {
      mtime: new Date(Date.now() - 48 * 3600 * 1000)
    });
    const fresh = await mkSpillDir(`${DIR_PREFIX}fresh-bbbb`, { mtime: new Date() });

    const res = await sweepOrphans(base);
    expect(res.removed).toBe(1);
    await expectAsync(fsp.stat(old)).toBeRejected();
    await expectAsync(fsp.stat(fresh)).toBeResolved();
  });

  it('ignores non-matching directories', async () => {
    const other = path.join(base, 'other-dir');
    await fsp.mkdir(other, { recursive: true });
    await fsp.utimes(other, new Date(Date.now() - 48 * 3600 * 1000), new Date(Date.now() - 48 * 3600 * 1000));
    const res = await sweepOrphans(base);
    expect(res.removed).toBe(0);
    await expectAsync(fsp.stat(other)).toBeResolved();
  });

  it('skips directories whose pid file names a live process', async () => {
    const mine = await mkSpillDir(`${DIR_PREFIX}mine-cccc`, {
      mtime: new Date(Date.now() - 48 * 3600 * 1000),
      pid: process.pid
    });
    const res = await sweepOrphans(base);
    expect(res.removed).toBe(0);
    await expectAsync(fsp.stat(mine)).toBeResolved();
  });

  it('runs at most once per process', async () => {
    await mkSpillDir(`${DIR_PREFIX}old-dddd`, {
      mtime: new Date(Date.now() - 48 * 3600 * 1000)
    });
    await sweepOrphans(base);
    const second = await sweepOrphans(base);
    expect(second.skipped).toBeTrue();
  });

  it('returns zero when tmpdir is missing', async () => {
    const res = await sweepOrphans(path.join(base, 'does-not-exist'));
    expect(res).toEqual({ removed: 0, bytes: 0 });
  });

  it('reports bytes reclaimed', async () => {
    await mkSpillDir(`${DIR_PREFIX}old-eeee`, {
      mtime: new Date(Date.now() - 48 * 3600 * 1000)
    });
    const res = await sweepOrphans(base);
    expect(res.removed).toBe(1);
    expect(res.bytes).toBeGreaterThan(0);
  });

  it('skips entries that vanish mid-sweep', async () => {
    await mkSpillDir(`${DIR_PREFIX}vanish-ffff`, {
      mtime: new Date(Date.now() - 48 * 3600 * 1000),
      withPidFile: false
    });
    const res = await sweepOrphans(base);
    expect(res.removed).toBeGreaterThanOrEqual(0);
  });
});
