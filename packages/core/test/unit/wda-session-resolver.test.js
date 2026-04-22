import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { resolveWdaSession } from '../../src/wda-session-resolver.js';
import { logger, setupTest } from '../helpers/index.js';

// Uses real tmpdirs instead of memfs because this module uses raw fs syscalls
// (openSync with O_NOFOLLOW, fstatSync) whose semantics we want to authentically
// exercise — not mock. Each test builds its own sid-named directory; baseDir
// is an explicit arg so we never touch the real /tmp/<sid>.

function mkBase() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'wda-session-test-'));
}

function writeMeta(baseDir, sid, content, { mode = 0o600, dirMode = 0o700 } = {}) {
  const sidDir = path.join(baseDir, sid);
  fs.mkdirSync(sidDir, { mode: dirMode });
  fs.chmodSync(sidDir, dirMode); // mkdir mode is umask-masked
  const file = path.join(sidDir, 'wda-meta.json');
  fs.writeFileSync(file, typeof content === 'string' ? content : JSON.stringify(content));
  fs.chmodSync(file, mode);
  return { sidDir, file };
}

function cleanup(baseDir) {
  try { fs.rmSync(baseDir, { recursive: true, force: true }); } catch {}
}

function happyMeta(sid, overrides = {}) {
  return {
    schema_version: '1.0.0',
    sessionId: sid,
    wdaPort: 8408,
    processOwner: process.getuid(),
    flowStartTimestamp: Date.now(),
    ...overrides
  };
}

describe('Unit / wda-session-resolver', () => {
  let baseDir;
  let startupTimestamp;
  const deps = () => ({
    getuid: () => process.getuid(),
    getStartupTimestamp: () => startupTimestamp
  });

  beforeEach(async () => {
    // Bypass memfs for our real-tmpdir paths — the resolver uses raw fs
    // syscalls (openSync with O_NOFOLLOW, fstatSync, linkSync, symlinkSync)
    // whose semantics memfs does not fully implement. Real fs in a per-test
    // scratch dir gives authentic POSIX behavior (ELOOP on O_NOFOLLOW, real
    // st_nlink, real mode bits).
    await setupTest({
      filesystem: { $bypass: [p => typeof p === 'string' && p.includes('wda-session-test-')] }
    });
    baseDir = mkBase();
    startupTimestamp = Date.now() - 2000; // 2s ago
  });

  afterEach(() => {
    cleanup(baseDir);
  });

  describe('happy path', () => {
    it('returns {ok: true, port} for a valid wda-meta.json', () => {
      const sid = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6';
      writeMeta(baseDir, sid, happyMeta(sid));
      const res = resolveWdaSession({ sessionId: sid, baseDir, deps: deps() });
      expect(res).toEqual({ ok: true, port: 8408 });
    });
  });

  describe('file-level validation (contract §4, §8)', () => {
    it('returns reason "missing" when the file does not exist', () => {
      const res = resolveWdaSession({ sessionId: 'nonexistent' + 'x'.repeat(20), baseDir, deps: deps() });
      expect(res).toEqual({ ok: false, reason: 'missing' });
    });

    it('returns reason "symlink" when wda-meta.json is a symlink (O_NOFOLLOW)', () => {
      const sid = 'symlinkattack' + crypto.randomBytes(8).toString('hex');
      const sidDir = path.join(baseDir, sid);
      fs.mkdirSync(sidDir, { mode: 0o700 });
      // Attacker pre-creates the meta path as a symlink to something else
      const attackerTarget = path.join(baseDir, 'attacker-target.txt');
      fs.writeFileSync(attackerTarget, '{"schema_version":"1.0.0","sessionId":"attacker","wdaPort":8408,"processOwner":0,"flowStartTimestamp":0}');
      fs.symlinkSync(attackerTarget, path.join(sidDir, 'wda-meta.json'));
      const res = resolveWdaSession({ sessionId: sid, baseDir, deps: deps() });
      expect(res).toEqual({ ok: false, reason: 'symlink' });
    });

    it('returns reason "wrong-mode" when the file mode is not 0600', () => {
      const sid = 'badmode0123' + crypto.randomBytes(8).toString('hex');
      writeMeta(baseDir, sid, happyMeta(sid), { mode: 0o644 });
      const res = resolveWdaSession({ sessionId: sid, baseDir, deps: deps() });
      expect(res).toEqual({ ok: false, reason: 'wrong-mode' });
    });

    it('returns reason "wrong-owner" when the file is owned by a different uid', () => {
      const sid = 'badowner012' + crypto.randomBytes(8).toString('hex');
      writeMeta(baseDir, sid, happyMeta(sid));
      // Simulate wrong owner via deps.getuid returning a different value.
      const alienDeps = { getuid: () => process.getuid() + 999, getStartupTimestamp: () => startupTimestamp };
      const res = resolveWdaSession({ sessionId: sid, baseDir, deps: alienDeps });
      expect(res).toEqual({ ok: false, reason: 'wrong-owner' });
    });

    it('returns reason "multi-link" when st_nlink != 1 (hardlink attack)', () => {
      const sid = 'hardlink012' + crypto.randomBytes(8).toString('hex');
      const { file } = writeMeta(baseDir, sid, happyMeta(sid));
      // Hardlink the file so st_nlink becomes 2.
      fs.linkSync(file, path.join(baseDir, 'attacker-hardlink'));
      const res = resolveWdaSession({ sessionId: sid, baseDir, deps: deps() });
      expect(res).toEqual({ ok: false, reason: 'multi-link' });
    });
  });

  describe('content validation (contract §2, §8)', () => {
    it('returns reason "malformed-json" on truncated JSON', () => {
      const sid = 'malformed01' + crypto.randomBytes(8).toString('hex');
      writeMeta(baseDir, sid, '{"schema_version":"1.0.0",');
      const res = resolveWdaSession({ sessionId: sid, baseDir, deps: deps() });
      expect(res).toEqual({ ok: false, reason: 'malformed-json' });
    });

    it('returns reason "schema-version-unsupported" when schema_version major != 1', () => {
      const sid = 'schemav2011' + crypto.randomBytes(8).toString('hex');
      writeMeta(baseDir, sid, happyMeta(sid, { schema_version: '2.0.0' }));
      const res = resolveWdaSession({ sessionId: sid, baseDir, deps: deps() });
      expect(res).toEqual({ ok: false, reason: 'schema-version-unsupported' });
    });

    it('accepts minor version bumps (1.1.0)', () => {
      const sid = 'minor11ok01' + crypto.randomBytes(8).toString('hex');
      writeMeta(baseDir, sid, happyMeta(sid, { schema_version: '1.1.0' }));
      const res = resolveWdaSession({ sessionId: sid, baseDir, deps: deps() });
      expect(res).toEqual({ ok: true, port: 8408 });
    });

    it('returns reason "malformed-json" when schema_version is missing', () => {
      const sid = 'noschemaver' + crypto.randomBytes(8).toString('hex');
      const meta = happyMeta(sid);
      delete meta.schema_version;
      writeMeta(baseDir, sid, meta);
      const res = resolveWdaSession({ sessionId: sid, baseDir, deps: deps() });
      expect(res).toEqual({ ok: false, reason: 'malformed-json' });
    });

    it('returns reason "out-of-range-port" when wdaPort is below 8400', () => {
      const sid = 'lowport0123' + crypto.randomBytes(8).toString('hex');
      writeMeta(baseDir, sid, happyMeta(sid, { wdaPort: 8000 }));
      const res = resolveWdaSession({ sessionId: sid, baseDir, deps: deps() });
      expect(res).toEqual({ ok: false, reason: 'out-of-range-port' });
    });

    it('returns reason "out-of-range-port" when wdaPort is above 8410', () => {
      const sid = 'hiport01234' + crypto.randomBytes(8).toString('hex');
      writeMeta(baseDir, sid, happyMeta(sid, { wdaPort: 9000 }));
      const res = resolveWdaSession({ sessionId: sid, baseDir, deps: deps() });
      expect(res).toEqual({ ok: false, reason: 'out-of-range-port' });
    });

    it('returns reason "session-mismatch" when file sessionId does not match request', () => {
      const sid = 'mismatch012' + crypto.randomBytes(8).toString('hex');
      writeMeta(baseDir, sid, happyMeta(sid, { sessionId: 'different-sid-0000000000000000' }));
      const res = resolveWdaSession({ sessionId: sid, baseDir, deps: deps() });
      expect(res).toEqual({ ok: false, reason: 'session-mismatch' });
    });

    it('returns reason "stale-timestamp" when flowStartTimestamp is older than startup minus 5min', () => {
      const sid = 'stale012345' + crypto.randomBytes(8).toString('hex');
      const sixMinutesBefore = startupTimestamp - 6 * 60 * 1000;
      writeMeta(baseDir, sid, happyMeta(sid, { flowStartTimestamp: sixMinutesBefore }));
      const res = resolveWdaSession({ sessionId: sid, baseDir, deps: deps() });
      expect(res).toEqual({ ok: false, reason: 'stale-timestamp' });
    });

    it('accepts freshness within the 5-min tolerance window', () => {
      const sid = 'freshinwin0' + crypto.randomBytes(8).toString('hex');
      const fourMinutesBefore = startupTimestamp - 4 * 60 * 1000;
      writeMeta(baseDir, sid, happyMeta(sid, { flowStartTimestamp: fourMinutesBefore }));
      const res = resolveWdaSession({ sessionId: sid, baseDir, deps: deps() });
      expect(res).toEqual({ ok: true, port: 8408 });
    });
  });

  describe('input validation', () => {
    it('returns reason "invalid-session-id" on path-traversal attempt', () => {
      const res = resolveWdaSession({ sessionId: '../../etc/passwd', baseDir, deps: deps() });
      expect(res).toEqual({ ok: false, reason: 'invalid-session-id' });
    });

    it('returns reason "invalid-session-id" on too-short sessionId', () => {
      const res = resolveWdaSession({ sessionId: 'short', baseDir, deps: deps() });
      expect(res).toEqual({ ok: false, reason: 'invalid-session-id' });
    });

    it('returns reason "invalid-session-id" on null-byte in sessionId', () => {
      const res = resolveWdaSession({ sessionId: 'valid12345678901234 evil', baseDir, deps: deps() });
      expect(res).toEqual({ ok: false, reason: 'invalid-session-id' });
    });

    it('returns reason "invalid-session-id" when sessionId is not a string', () => {
      const res = resolveWdaSession({ sessionId: 12345, baseDir, deps: deps() });
      expect(res).toEqual({ ok: false, reason: 'invalid-session-id' });
    });
  });

  describe('log scrubbing', () => {
    it('never emits file contents, path, port, or uid in logs across all reason codes', () => {
      const sid = 'scrubcheck0' + crypto.randomBytes(8).toString('hex');
      writeMeta(baseDir, sid, happyMeta(sid, { wdaPort: 8408 }));
      resolveWdaSession({ sessionId: sid, baseDir, deps: deps() });

      const joined = [
        ...(logger.stderr || []),
        ...(logger.stdout || [])
      ].join('\n');

      // Forbidden fields per R7 (contract §5):
      expect(joined).not.toContain('8408');
      expect(joined).not.toContain(String(process.getuid()));
      expect(joined).not.toContain(sid);
      expect(joined).not.toContain('wda-meta.json');
      expect(joined).not.toContain(baseDir);
    });
  });
});
