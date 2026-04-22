import os from 'os';
import path from 'path';
import { promises as fsp } from 'fs';
import { sweepOrphans, __resetGuard, DIR_PREFIX } from '@percy/logger/orphan-cleanup';

describe('sweepOrphans', () => {
  let base;
  beforeEach(async () => {
    __resetGuard();
    base = await fsp.mkdtemp(path.join(os.tmpdir(), 'percy-sweep-test-'));
  });
  afterEach(async () => {
    try { await fsp.rm(base, { recursive: true, force: true }); } catch (_) {}
  });

  async function mkSpillDir (name, { mtime, pid, withPidFile = true } = {}) {
    const dir = path.join(base, name);
    await fsp.mkdir(dir, { recursive: true });
    await fsp.writeFile(path.join(dir, 'build.log.jsonl'), 'x'.repeat(100));
    if (withPidFile) {
      await fsp.writeFile(path.join(dir, 'pid'), String(pid ?? 999999999));
    }
    if (mtime) await fsp.utimes(dir, mtime, mtime);
    return dir;
  }

  it('removes directories older than 24h', async () => {
    const old = await mkSpillDir(`${DIR_PREFIX}old-aaaa`, {
      mtime: new Date(Date.now() - 48 * 3600 * 1000)
    });
    const fresh = await mkSpillDir(`${DIR_PREFIX}fresh-bbbb`, {
      mtime: new Date()
    });

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

  it('runs at most once per process (module-level guard)', async () => {
    await mkSpillDir(`${DIR_PREFIX}old-dddd`, {
      mtime: new Date(Date.now() - 48 * 3600 * 1000)
    });
    await sweepOrphans(base);

    // Second call without __resetGuard — should no-op.
    const second = await sweepOrphans(base);
    expect(second.skipped).toBeTrue();
  });

  it('returns zero when tmpdir is missing', async () => {
    const missing = path.join(base, 'does-not-exist');
    const res = await sweepOrphans(missing);
    expect(res).toEqual({ removed: 0, bytes: 0 });
  });

  it('reports bytes reclaimed approximately', async () => {
    await mkSpillDir(`${DIR_PREFIX}old-eeee`, {
      mtime: new Date(Date.now() - 48 * 3600 * 1000)
    });
    const res = await sweepOrphans(base);
    expect(res.removed).toBe(1);
    expect(res.bytes).toBeGreaterThan(0);
  });
});
