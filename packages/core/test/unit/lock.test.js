import { setupTest } from '../helpers/index.js';
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync, existsSync, statSync, rmSync } from 'fs';
import { join } from 'path';
import os from 'os';
import { acquireLock, releaseLockSync, lockPathFor, LockHeldError } from '../../src/lock.js';

describe('Unit / Lock', () => {
  let fakeHome;

  beforeEach(async () => {
    await setupTest();

    // Redirect `os.homedir()` to a per-test tmp dir so we never touch
    // the real $HOME. mkdtempSync gives a unique, writable dir.
    fakeHome = mkdtempSync(join(os.tmpdir(), 'percy-lock-test-'));
    spyOn(os, 'homedir').and.returnValue(fakeHome);
  });

  afterEach(() => {
    /* istanbul ignore next: best-effort cleanup */
    try { rmSync(fakeHome, { recursive: true, force: true }); } catch {}
  });

  describe('acquireLock', () => {
    it('writes a lock with our pid, port and an ISO startedAt', () => {
      let handle = acquireLock({ port: 5338 });
      let parsed = JSON.parse(readFileSync(handle.path, 'utf-8'));

      expect(parsed.pid).toBe(process.pid);
      expect(parsed.port).toBe(5338);
      expect(parsed.startedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(handle.path).toBe(lockPathFor(5338));
    });

    it('creates ~/.percy/ if it does not exist (mkdir -p)', () => {
      let dir = join(fakeHome, '.percy');
      expect(existsSync(dir)).toBe(false);
      acquireLock({ port: 5338 });
      expect(existsSync(dir)).toBe(true);
    });

    // SC3 — stale-lock reclaim
    it('reclaims a stale lock whose recorded pid is dead', () => {
      // PID 99999999 is reliably non-existent (Linux pid_max is ~4M).
      let stalePath = lockPathFor(5338);
      mkdirSync(join(fakeHome, '.percy'), { recursive: true });
      writeFileSync(stalePath, JSON.stringify({ pid: 99999999, port: 5338, startedAt: '1970-01-01T00:00:00.000Z' }));

      let handle = acquireLock({ port: 5338 });

      let parsed = JSON.parse(readFileSync(handle.path, 'utf-8'));
      expect(parsed.pid).toBe(process.pid);
    });

    // SC4 — live-lock refusal with actionable message.
    // We mock process.kill so we don't depend on a specific live pid
    // existing on the test host, and so the recorded pid (12345) is
    // distinguishable from process.pid (otherwise the self-pid stale
    // optimization would kick in and reclaim).
    it('throws LockHeldError when a live foreign process holds the lock', () => {
      let livePid = 12345;
      let path = lockPathFor(5338);
      mkdirSync(join(fakeHome, '.percy'), { recursive: true });
      writeFileSync(path, JSON.stringify({ pid: livePid, port: 5338, startedAt: '2026-04-27T10:00:00.000Z' }));
      spyOn(process, 'kill').and.returnValue(true);

      let err;
      try { acquireLock({ port: 5338 }); } catch (e) { err = e; }

      expect(err).toBeInstanceOf(LockHeldError);
      expect(err.meta.pid).toBe(livePid);
      expect(err.meta.port).toBe(5338);
      expect(err.lockPath).toBe(path);
      expect(err.message).toContain(`pid ${livePid}`);
      expect(err.message).toContain(path);
    });

    it('reclaims a self-pid lock (leaked from earlier in same process)', () => {
      let path = lockPathFor(5338);
      mkdirSync(join(fakeHome, '.percy'), { recursive: true });
      writeFileSync(path, JSON.stringify({ pid: process.pid, port: 5338, startedAt: '2026-04-27T10:00:00.000Z' }));

      let handle = acquireLock({ port: 5338 });

      let parsed = JSON.parse(readFileSync(handle.path, 'utf-8'));
      expect(parsed.pid).toBe(process.pid);
      expect(parsed.startedAt).not.toBe('2026-04-27T10:00:00.000Z');
    });

    it('treats EPERM from process.kill as alive (cross-user pid)', () => {
      let path = lockPathFor(5338);
      mkdirSync(join(fakeHome, '.percy'), { recursive: true });
      writeFileSync(path, JSON.stringify({ pid: 1, port: 5338, startedAt: '2026-04-27T10:00:00.000Z' }));

      // Stub process.kill to throw EPERM (different-user-owned pid).
      spyOn(process, 'kill').and.callFake(() => {
        let err = new Error('Operation not permitted');
        err.code = 'EPERM';
        throw err;
      });

      expect(() => acquireLock({ port: 5338 })).toThrowMatching(e => e instanceof LockHeldError);
    });

    it('reclaims a corrupt-payload lock (truncated JSON)', () => {
      let path = lockPathFor(5338);
      mkdirSync(join(fakeHome, '.percy'), { recursive: true });
      writeFileSync(path, '{not valid json'); // simulate mid-write crash

      let handle = acquireLock({ port: 5338 });

      let parsed = JSON.parse(readFileSync(handle.path, 'utf-8'));
      expect(parsed.pid).toBe(process.pid);
    });

    // SC5 — parallel multi-port: two locks on different ports coexist.
    it('allows distinct ports to lock concurrently', () => {
      let h1 = acquireLock({ port: 5338 });
      let h2 = acquireLock({ port: 5339 });

      expect(h1.path).not.toBe(h2.path);
      expect(existsSync(h1.path)).toBe(true);
      expect(existsSync(h2.path)).toBe(true);
    });

    // POSIX-only: mode bits aren't faithfully represented on Windows.
    it('writes lock file with mode 0o600 and parent dir 0o700', () => {
      if (process.platform.startsWith('win')) {
        pending('mode bits not preserved on Windows');
        return;
      }

      let handle = acquireLock({ port: 5338 });
      let fileMode = statSync(handle.path).mode & 0o777;
      let dirMode = statSync(join(fakeHome, '.percy')).mode & 0o777;

      expect(fileMode).toBe(0o600);
      expect(dirMode).toBe(0o700);
    });
  });

  describe('releaseLockSync', () => {
    it('removes the lock file', () => {
      let handle = acquireLock({ port: 5338 });
      expect(existsSync(handle.path)).toBe(true);

      releaseLockSync(handle);

      expect(existsSync(handle.path)).toBe(false);
    });

    it('is a no-op for a missing handle', () => {
      expect(() => releaseLockSync(undefined)).not.toThrow();
      expect(() => releaseLockSync({})).not.toThrow();
      expect(() => releaseLockSync(null)).not.toThrow();
    });

    it('is a no-op when the lock file is already gone', () => {
      let handle = acquireLock({ port: 5338 });
      releaseLockSync(handle);
      expect(() => releaseLockSync(handle)).not.toThrow();
    });

    it('lets a fresh process re-acquire after release', () => {
      let h1 = acquireLock({ port: 5338 });
      releaseLockSync(h1);

      let h2 = acquireLock({ port: 5338 });
      expect(h2.path).toBe(h1.path);
    });
  });
});
