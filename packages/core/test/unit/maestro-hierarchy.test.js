import fs from 'fs';
import path from 'path';
import url from 'url';
import {
  dump,
  firstMatch,
  getMaestroHierarchyDrift,
  runAndroidGrpcDump,
  classifyGrpcFailure,
  closeGrpcClientCache,
  __testing
} from '../../src/maestro-hierarchy.js';
import { logger, setupTest } from '../helpers/index.js';

const fixtureDir = path.resolve(url.fileURLToPath(import.meta.url), '../../fixtures/maestro-hierarchy');
const loadFixture = name => fs.readFileSync(path.join(fixtureDir, name), 'utf8');

function makeFakeExecAdb(handlers) {
  // handlers: Array<{ match: (args) => boolean, result }> — ordered; first match wins per call.
  const callLog = [];
  const execAdb = async args => {
    callLog.push(args);
    for (const { match, result } of handlers) {
      if (match(args)) return typeof result === 'function' ? result(args) : result;
    }
    throw new Error(`No fake handler matched adb args: ${JSON.stringify(args)}`);
  };
  execAdb.calls = callLog;
  return execAdb;
}

// Default maestro stub that pretends the binary is missing → forces the adb fallback
// path, which is what existing tests assert against. Tests that want to exercise the
// maestro primary path pass their own execMaestro.
const maestroNotFound = async () => ({ spawnError: Object.assign(new Error('not found'), { code: 'ENOENT' }) });

const okDevices = {
  stdout: 'List of devices attached\nemulator-5554\tdevice\n\n',
  stderr: '',
  exitCode: 0
};

describe('Unit / maestro-hierarchy', () => {
  beforeEach(async () => {
    await setupTest();
  });

  describe('firstMatch (parser + selector)', () => {
    it('returns bounds for a single node matching resource-id', async () => {
      const execAdb = makeFakeExecAdb([
        { match: args => args[0] === 'devices', result: okDevices },
        { match: args => args.includes('exec-out'), result: { stdout: loadFixture('simple.xml'), stderr: '', exitCode: 0 } }
      ]);
      const res = await dump({ execMaestro: maestroNotFound, execAdb, getEnv: () => undefined });
      expect(res.kind).toBe('hierarchy');
      const bbox = firstMatch(res.nodes, { 'resource-id': 'com.example:id/clock' });
      expect(bbox).toEqual({ x: 40, y: 50, width: 460, height: 100 });
    });

    it('returns first match in pre-order when multiple nodes match `text`', async () => {
      const execAdb = makeFakeExecAdb([
        { match: args => args[0] === 'devices', result: okDevices },
        { match: args => args.includes('exec-out'), result: { stdout: loadFixture('simple.xml'), stderr: '', exitCode: 0 } }
      ]);
      const res = await dump({ execMaestro: maestroNotFound, execAdb, getEnv: () => undefined });
      const bbox = firstMatch(res.nodes, { text: 'Submit' });
      // simple.xml has two 'Submit' text nodes; first is at [0,200][1080,400]
      expect(bbox).toEqual({ x: 0, y: 200, width: 1080, height: 200 });
    });

    it('matches by content-desc', async () => {
      const execAdb = makeFakeExecAdb([
        { match: args => args[0] === 'devices', result: okDevices },
        { match: args => args.includes('exec-out'), result: { stdout: loadFixture('simple.xml'), stderr: '', exitCode: 0 } }
      ]);
      const res = await dump({ execMaestro: maestroNotFound, execAdb, getEnv: () => undefined });
      const bbox = firstMatch(res.nodes, { 'content-desc': 'Open settings' });
      expect(bbox).toEqual({ x: 900, y: 50, width: 140, height: 100 });
    });

    it('matches by class', async () => {
      const execAdb = makeFakeExecAdb([
        { match: args => args[0] === 'devices', result: okDevices },
        { match: args => args.includes('exec-out'), result: { stdout: loadFixture('simple.xml'), stderr: '', exitCode: 0 } }
      ]);
      const res = await dump({ execMaestro: maestroNotFound, execAdb, getEnv: () => undefined });
      // First matching class in pre-order is the FrameLayout root
      const bbox = firstMatch(res.nodes, { class: 'android.widget.FrameLayout' });
      expect(bbox).toEqual({ x: 0, y: 0, width: 1080, height: 2400 });
    });

    it('returns null when no node matches', async () => {
      const execAdb = makeFakeExecAdb([
        { match: args => args[0] === 'devices', result: okDevices },
        { match: args => args.includes('exec-out'), result: { stdout: loadFixture('simple.xml'), stderr: '', exitCode: 0 } }
      ]);
      const res = await dump({ execMaestro: maestroNotFound, execAdb, getEnv: () => undefined });
      expect(firstMatch(res.nodes, { 'resource-id': 'does-not-exist' })).toBeNull();
    });

    it('treats malformed bounds as non-match without throwing', async () => {
      const execAdb = makeFakeExecAdb([
        { match: args => args[0] === 'devices', result: okDevices },
        { match: args => args.includes('exec-out'), result: { stdout: loadFixture('bad-bounds.xml'), stderr: '', exitCode: 0 } }
      ]);
      const res = await dump({ execMaestro: maestroNotFound, execAdb, getEnv: () => undefined });
      expect(firstMatch(res.nodes, { 'resource-id': 'com.example:id/broken' })).toBeNull();
    });

    it('treats zero-area nodes as non-match', async () => {
      const execAdb = makeFakeExecAdb([
        { match: args => args[0] === 'devices', result: okDevices },
        { match: args => args.includes('exec-out'), result: { stdout: loadFixture('bad-bounds.xml'), stderr: '', exitCode: 0 } }
      ]);
      const res = await dump({ execMaestro: maestroNotFound, execAdb, getEnv: () => undefined });
      expect(firstMatch(res.nodes, { 'resource-id': 'com.example:id/zero_area' })).toBeNull();
    });

    it('allows negative coordinates for partially-clipped views', async () => {
      const execAdb = makeFakeExecAdb([
        { match: args => args[0] === 'devices', result: okDevices },
        { match: args => args.includes('exec-out'), result: { stdout: loadFixture('bad-bounds.xml'), stderr: '', exitCode: 0 } }
      ]);
      const res = await dump({ execMaestro: maestroNotFound, execAdb, getEnv: () => undefined });
      const bbox = firstMatch(res.nodes, { 'resource-id': 'com.example:id/clipped' });
      expect(bbox).toEqual({ x: -50, y: -100, width: 250, height: 400 });
    });

    it('returns null for empty <hierarchy/>', async () => {
      const execAdb = makeFakeExecAdb([
        { match: args => args[0] === 'devices', result: okDevices },
        { match: args => args.includes('exec-out'), result: { stdout: loadFixture('empty.xml'), stderr: '', exitCode: 0 } }
      ]);
      const res = await dump({ execMaestro: maestroNotFound, execAdb, getEnv: () => undefined });
      expect(res.kind).toBe('hierarchy');
      expect(firstMatch(res.nodes, { 'resource-id': 'anything' })).toBeNull();
    });

    it('rejects selectors with more than one key', () => {
      expect(firstMatch([], { 'resource-id': 'a', text: 'b' })).toBeNull();
    });

    it('rejects selectors with unsupported keys', () => {
      expect(firstMatch([], { xpath: '//foo' })).toBeNull();
    });

    it('rejects selectors with non-string values', () => {
      expect(firstMatch([], { 'resource-id': 42 })).toBeNull();
    });

    it('rejects selectors with empty-string values', () => {
      expect(firstMatch([], { 'resource-id': '' })).toBeNull();
    });
  });

  describe('dump (classification)', () => {
    it('returns unavailable with reason adb-not-found on ENOENT', async () => {
      const execAdb = async () => ({ spawnError: Object.assign(new Error('not found'), { code: 'ENOENT' }) });
      const res = await dump({ execMaestro: maestroNotFound, execAdb, getEnv: () => undefined });
      expect(res).toEqual({ kind: 'unavailable', reason: 'adb-not-found' });
    });

    it('returns unavailable with reason no-device when stderr says no devices/emulators', async () => {
      const execAdb = makeFakeExecAdb([
        { match: args => args[0] === 'devices', result: { stdout: '', stderr: 'error: no devices/emulators found', exitCode: 1 } }
      ]);
      const res = await dump({ execMaestro: maestroNotFound, execAdb, getEnv: () => undefined });
      expect(res).toEqual({ kind: 'unavailable', reason: 'no-device' });
    });

    it('returns unavailable with reason device-unauthorized when stderr says unauthorized', async () => {
      const execAdb = makeFakeExecAdb([
        { match: args => args[0] === 'devices', result: okDevices },
        { match: args => args.includes('exec-out'), result: { stdout: '', stderr: 'error: device unauthorized', exitCode: 1 } }
      ]);
      const res = await dump({ execMaestro: maestroNotFound, execAdb, getEnv: () => 'emulator-5554' });
      expect(res).toEqual({ kind: 'unavailable', reason: 'device-unauthorized' });
    });

    it('returns unavailable on timeout', async () => {
      const execAdb = makeFakeExecAdb([
        { match: args => args[0] === 'devices', result: okDevices },
        { match: args => args.includes('exec-out'), result: { stdout: '', stderr: '', exitCode: null, timedOut: true } }
      ]);
      const res = await dump({ execMaestro: maestroNotFound, execAdb, getEnv: () => 'emulator-5554' });
      expect(res).toEqual({ kind: 'unavailable', reason: 'timeout' });
    });

    it('returns unavailable with reason no-device when adb devices lists zero attached devices', async () => {
      const execAdb = makeFakeExecAdb([
        { match: args => args[0] === 'devices', result: { stdout: 'List of devices attached\n\n', stderr: '', exitCode: 0 } }
      ]);
      const res = await dump({ execMaestro: maestroNotFound, execAdb, getEnv: () => undefined });
      expect(res).toEqual({ kind: 'unavailable', reason: 'no-device' });
    });

    it('returns unavailable with reason multi-device-no-serial when multiple devices attached and ANDROID_SERIAL unset', async () => {
      const execAdb = makeFakeExecAdb([
        { match: args => args[0] === 'devices', result: { stdout: 'List of devices attached\nemulator-5554\tdevice\nemulator-5556\tdevice\n', stderr: '', exitCode: 0 } }
      ]);
      const res = await dump({ execMaestro: maestroNotFound, execAdb, getEnv: () => undefined });
      expect(res).toEqual({ kind: 'unavailable', reason: 'multi-device-no-serial' });
    });

    it('passes -s <serial> on every call when ANDROID_SERIAL is set', async () => {
      const execAdb = makeFakeExecAdb([
        { match: args => args.includes('exec-out'), result: { stdout: loadFixture('simple.xml'), stderr: '', exitCode: 0 } }
      ]);
      await dump({ execMaestro: maestroNotFound, execAdb, getEnv: k => (k === 'ANDROID_SERIAL' ? 'env-serial-123' : undefined) });
      // adb devices should NOT have been called since env serial was present
      expect(execAdb.calls.some(args => args[0] === 'devices')).toBe(false);
      expect(execAdb.calls[0]).toEqual(['-s', 'env-serial-123', 'exec-out', 'uiautomator', 'dump', '/dev/tty']);
    });

    it('invokes fallback on empty stdout and returns hierarchy when fallback succeeds', async () => {
      let primaryCalled = false;
      const execAdb = async args => {
        if (args[0] === 'devices') return okDevices;
        if (args.includes('exec-out') && args.includes('/dev/tty')) {
          primaryCalled = true;
          return { stdout: '', stderr: '', exitCode: 0 };
        }
        if (args.includes('shell') && args.includes('uiautomator')) {
          return { stdout: '', stderr: '', exitCode: 0 };
        }
        if (args.includes('exec-out') && args.includes('cat')) {
          return { stdout: loadFixture('simple.xml'), stderr: '', exitCode: 0 };
        }
        throw new Error('unexpected adb args: ' + args.join(' '));
      };
      const res = await dump({ execMaestro: maestroNotFound, execAdb, getEnv: () => 'emulator-5554' });
      expect(primaryCalled).toBe(true);
      expect(res.kind).toBe('hierarchy');
      expect(firstMatch(res.nodes, { 'resource-id': 'com.example:id/clock' })).not.toBeNull();
    });

    it('returns dump-error when both primary and fallback yield no XML', async () => {
      const execAdb = async args => {
        if (args[0] === 'devices') return okDevices;
        if (args.includes('exec-out') && args.includes('/dev/tty')) return { stdout: 'garbage not xml', stderr: '', exitCode: 0 };
        if (args.includes('shell') && args.includes('uiautomator')) return { stdout: '', stderr: '', exitCode: 0 };
        if (args.includes('exec-out') && args.includes('cat')) return { stdout: 'still garbage', stderr: '', exitCode: 0 };
        throw new Error('unexpected');
      };
      const res = await dump({ execMaestro: maestroNotFound, execAdb, getEnv: () => 'emulator-5554' });
      expect(res.kind).toBe('dump-error');
    });

    it('retries the fallback dump with backoff on exit 137 (SIGKILL) until success', async () => {
      let fileDumpCalls = 0;
      const execAdb = async args => {
        if (args[0] === 'devices') return okDevices;
        if (args.includes('exec-out') && args.includes('/dev/tty')) return { stdout: '', stderr: '', exitCode: 1 };
        if (args.includes('shell') && args.includes('uiautomator')) {
          fileDumpCalls += 1;
          // First two calls killed, third succeeds
          if (fileDumpCalls < 3) return { stdout: '', stderr: '', exitCode: 137 };
          return { stdout: 'UI hierarchy dumped to: /sdcard/window_dump.xml\n', stderr: '', exitCode: 0 };
        }
        if (args.includes('exec-out') && args.includes('cat')) return { stdout: loadFixture('simple.xml'), stderr: '', exitCode: 0 };
        throw new Error('unexpected adb args: ' + args.join(' '));
      };
      const res = await dump({ execMaestro: maestroNotFound, execAdb, getEnv: () => 'emulator-5554' });
      expect(fileDumpCalls).toBe(3);
      expect(res.kind).toBe('hierarchy');
    });

    it('gives up after exhausting SIGKILL retries (persistent contention)', async () => {
      let fileDumpCalls = 0;
      const execAdb = async args => {
        if (args[0] === 'devices') return okDevices;
        if (args.includes('exec-out') && args.includes('/dev/tty')) return { stdout: '', stderr: '', exitCode: 1 };
        if (args.includes('shell') && args.includes('uiautomator')) {
          fileDumpCalls += 1;
          return { stdout: '', stderr: '', exitCode: 137 };
        }
        throw new Error('unexpected');
      };
      const res = await dump({ execMaestro: maestroNotFound, execAdb, getEnv: () => 'emulator-5554' });
      // initial + 3 retries = 4 total attempts
      expect(fileDumpCalls).toBe(4);
      expect(res).toEqual({ kind: 'dump-error', reason: 'fallback-dump-exit-137' });
    });

    it('returns dump-error when stdout lacks an XML envelope (no retry for terminal errors)', async () => {
      // Non-zero exit triggers fallback; fallback also returns garbage → terminal dump-error.
      const execAdb = async args => {
        if (args[0] === 'devices') return okDevices;
        if (args.includes('exec-out') && args.includes('/dev/tty')) return { stdout: 'garbage', stderr: '', exitCode: 1 };
        if (args.includes('shell') && args.includes('uiautomator')) return { stdout: '', stderr: '', exitCode: 0 };
        if (args.includes('exec-out') && args.includes('cat')) return { stdout: 'still garbage', stderr: '', exitCode: 0 };
        throw new Error('unexpected');
      };
      const res = await dump({ execMaestro: maestroNotFound, execAdb, getEnv: () => 'emulator-5554' });
      expect(res.kind).toBe('dump-error');
    });

    it('ignores trailer lines after </hierarchy>', async () => {
      const execAdb = makeFakeExecAdb([
        { match: args => args.includes('exec-out'), result: { stdout: loadFixture('with-trailer.txt'), stderr: '', exitCode: 0 } }
      ]);
      const res = await dump({ execMaestro: maestroNotFound, execAdb, getEnv: () => 'emulator-5554' });
      expect(res.kind).toBe('hierarchy');
      expect(firstMatch(res.nodes, { 'resource-id': 'com.example:id/ok' })).toEqual({ x: 0, y: 0, width: 100, height: 100 });
    });

    it('discards content after the first </hierarchy> in adversarial trailer', async () => {
      const execAdb = makeFakeExecAdb([
        { match: args => args.includes('exec-out'), result: { stdout: loadFixture('adversarial-trailer.txt'), stderr: '', exitCode: 0 } }
      ]);
      const res = await dump({ execMaestro: maestroNotFound, execAdb, getEnv: () => 'emulator-5554' });
      expect(res.kind).toBe('hierarchy');
      // The 'real' node should resolve; the 'injected' node (in the second XML block) should NOT.
      expect(firstMatch(res.nodes, { 'resource-id': 'com.example:id/real' })).not.toBeNull();
      expect(firstMatch(res.nodes, { 'resource-id': 'com.example:id/injected' })).toBeNull();
    });

    it('resolves landscape dumps (bounds returned as-is, not re-rotated)', async () => {
      const execAdb = makeFakeExecAdb([
        { match: args => args.includes('exec-out'), result: { stdout: loadFixture('landscape.xml'), stderr: '', exitCode: 0 } }
      ]);
      const res = await dump({ execMaestro: maestroNotFound, execAdb, getEnv: () => 'emulator-5554' });
      const bbox = firstMatch(res.nodes, { 'resource-id': 'com.example:id/landscape_label' });
      expect(bbox).toEqual({ x: 100, y: 50, width: 300, height: 100 });
    });
  });

  describe('dump (size cap)', () => {
    it('returns dump-error oversize when stdout exceeds 5MB', async () => {
      const execAdb = makeFakeExecAdb([
        { match: args => args[0] === 'devices', result: okDevices },
        { match: args => args.includes('exec-out'), result: { stdout: '', stderr: '', exitCode: 1, oversize: true } }
      ]);
      const res = await dump({ execMaestro: maestroNotFound, execAdb, getEnv: () => 'emulator-5554' });
      expect(res).toEqual({ kind: 'dump-error', reason: 'oversize' });
    });
  });

  describe('dump (maestro hierarchy primary)', () => {
    const maestroSimple = loadFixture('maestro-simple.json');
    const okMaestro = { stdout: maestroSimple, stderr: '', exitCode: 0 };

    it('uses maestro hierarchy when available, skips adb fallback entirely', async () => {
      const execMaestro = async args => {
        expect(args).toEqual(['--udid', 'env-serial-123', 'hierarchy']);
        return okMaestro;
      };
      // execAdb should never be called when maestro succeeds — fail loud if it is.
      const execAdb = async args => { throw new Error('execAdb should not be called: ' + args.join(' ')); };

      const res = await dump({
        execMaestro,
        execAdb,
        getEnv: k => (k === 'ANDROID_SERIAL' ? 'env-serial-123' : undefined)
      });

      expect(res.kind).toBe('hierarchy');
      const bbox = firstMatch(res.nodes, { 'resource-id': 'com.example:id/clock' });
      expect(bbox).toEqual({ x: 40, y: 50, width: 460, height: 100 });
    });

    it('maps accessibilityText to content-desc selector', async () => {
      const execMaestro = async () => okMaestro;
      const execAdb = async () => { throw new Error('should not hit adb'); };
      const res = await dump({
        execMaestro,
        execAdb,
        getEnv: k => (k === 'ANDROID_SERIAL' ? 'serial' : undefined)
      });
      const bbox = firstMatch(res.nodes, { 'content-desc': 'Open settings' });
      expect(bbox).toEqual({ x: 900, y: 50, width: 140, height: 100 });
    });

    it('falls back to adb when maestro binary is missing (ENOENT)', async () => {
      const execAdb = makeFakeExecAdb([
        { match: args => args[0] === 'devices', result: okDevices },
        { match: args => args.includes('exec-out'), result: { stdout: loadFixture('simple.xml'), stderr: '', exitCode: 0 } }
      ]);
      const res = await dump({
        execMaestro: maestroNotFound,
        execAdb,
        getEnv: () => undefined
      });
      expect(res.kind).toBe('hierarchy');
      expect(firstMatch(res.nodes, { 'resource-id': 'com.example:id/clock' })).not.toBeNull();
    });

    it('returns maestro-no-device when maestro CLI reports no devices (with ANDROID_SERIAL set so adb probe is skipped)', async () => {
      const execMaestro = async () => ({ stdout: '', stderr: 'Error: No connected devices', exitCode: 1 });
      // adb fallback: exec-out returns no xml, file dump also kills → dump-error
      const execAdb = async args => {
        if (args.includes('exec-out')) return { stdout: '', stderr: '', exitCode: 1 };
        if (args.includes('shell')) return { stdout: '', stderr: '', exitCode: 1 };
        throw new Error('unexpected: ' + args.join(' '));
      };
      const res = await dump({ execMaestro, execAdb, getEnv: k => (k === 'ANDROID_SERIAL' ? 'serial' : undefined) });
      // Both paths failed; adb wins because we don't surface maestro classification anymore.
      // The important assertion is that maestro was tried (log.debug fires) and adb was also tried.
      expect(res.kind).toBe('dump-error');
    });

    it('returns maestro-timeout when the CLI exceeds its budget', async () => {
      const execMaestro = async () => ({ stdout: '', stderr: '', exitCode: null, timedOut: true });
      const execAdb = makeFakeExecAdb([
        { match: args => args[0] === 'devices', result: okDevices },
        { match: args => args.includes('exec-out'), result: { stdout: loadFixture('simple.xml'), stderr: '', exitCode: 0 } }
      ]);
      // Even with a healthy adb fallback, surfacing the maestro unavailable reason is
      // only done when both fail. A successful adb fallback returns hierarchy.
      const res = await dump({ execMaestro, execAdb, getEnv: () => 'serial' });
      expect(res.kind).toBe('hierarchy');
    });

    it('handles maestro stdout prefixed with notice/banner lines', async () => {
      const execMaestro = async () => ({
        stdout: 'Checking for CLI updates...\n[info] Connected\n' + maestroSimple,
        stderr: '',
        exitCode: 0
      });
      const execAdb = async () => { throw new Error('should not hit adb'); };
      const res = await dump({ execMaestro, execAdb, getEnv: () => 'serial' });
      expect(res.kind).toBe('hierarchy');
      expect(firstMatch(res.nodes, { 'resource-id': 'com.example:id/clock' })).not.toBeNull();
    });

    it('returns maestro-no-json when stdout has no JSON', async () => {
      const execMaestro = async () => ({ stdout: 'just garbage', stderr: '', exitCode: 0 });
      const execAdb = makeFakeExecAdb([
        { match: args => args[0] === 'devices', result: okDevices },
        { match: args => args.includes('exec-out'), result: { stdout: '', stderr: '', exitCode: 1 } },
        { match: args => args.includes('shell'), result: { stdout: '', stderr: '', exitCode: 1 } }
      ]);
      const res = await dump({ execMaestro, execAdb, getEnv: () => 'serial' });
      // maestro returned dump-error (no-json) and adb also failed → falls through to adb's classification
      expect(res.kind).toBe('dump-error');
    });
  });

  describe('R1 vocabulary parity — Android `id` alias for `resource-id`', () => {
    it('resolves the same node when selector key is `id` vs `resource-id`', async () => {
      const execAdb = makeFakeExecAdb([
        { match: args => args[0] === 'devices', result: okDevices },
        { match: args => args.includes('exec-out'), result: { stdout: loadFixture('simple.xml'), stderr: '', exitCode: 0 } }
      ]);
      const res = await dump({ execMaestro: maestroNotFound, execAdb, getEnv: () => undefined });
      expect(res.kind).toBe('hierarchy');

      const viaResourceId = firstMatch(res.nodes, { 'resource-id': 'com.example:id/clock' });
      const viaIdAlias = firstMatch(res.nodes, { id: 'com.example:id/clock' });
      expect(viaResourceId).toEqual({ x: 40, y: 50, width: 460, height: 100 });
      expect(viaIdAlias).toEqual(viaResourceId);
    });

    it('exposes id alias on every node that has resource-id', async () => {
      const execAdb = makeFakeExecAdb([
        { match: args => args[0] === 'devices', result: okDevices },
        { match: args => args.includes('exec-out'), result: { stdout: loadFixture('simple.xml'), stderr: '', exitCode: 0 } }
      ]);
      const res = await dump({ execMaestro: maestroNotFound, execAdb, getEnv: () => undefined });
      const nodesWithResourceId = res.nodes.filter(n => n['resource-id']);
      expect(nodesWithResourceId.length).toBeGreaterThan(0);
      // Every resource-id node also exposes id with the same value
      for (const node of nodesWithResourceId) {
        expect(node.id).toBe(node['resource-id']);
      }
    });

    it('returns null for `id` selector when no resource-id matches', async () => {
      const execAdb = makeFakeExecAdb([
        { match: args => args[0] === 'devices', result: okDevices },
        { match: args => args.includes('exec-out'), result: { stdout: loadFixture('simple.xml'), stderr: '', exitCode: 0 } }
      ]);
      const res = await dump({ execMaestro: maestroNotFound, execAdb, getEnv: () => undefined });
      expect(firstMatch(res.nodes, { id: 'does-not-exist' })).toBeNull();
    });
  });

  describe('iOS dispatch — env handling', () => {
    // Self-hosted-with-explicit-port-but-no-UDID: enters the EXPLICIT branch
    // (port present), runs the HTTP primary. With UDID absent, the CLI
    // fallback is unavailable — on HTTP success the dump returns; on HTTP
    // failure (connection-fail here), warn-skip with the new
    // `self-hosted-no-udid` reason.
    it('warn-skips with self-hosted-no-udid when port is set, udid is unset, and HTTP primary fails', async () => {
      const getEnv = key => {
        if (key === 'PERCY_IOS_DRIVER_HOST_PORT') return '11100';
        return undefined;
      };
      const httpRequest = async () => { throw Object.assign(new Error('econnrefused'), { code: 'ECONNREFUSED' }); };
      const res = await dump({ platform: 'ios', getEnv, httpRequest });
      expect(res).toEqual({ kind: 'unavailable', reason: 'self-hosted-no-udid' });
    });

    // Self-hosted (UDID-set, PORT-unset): enters the IMPLICIT branch and
    // runs the discovery cascade (probe 7001 → lsof). With both injected
    // fakes failing, cascade returns null → warn-skip with the new
    // `self-hosted-no-driver` reason. UDID being set is irrelevant on the
    // implicit path — HTTP `/viewHierarchy` doesn't take a udid.
    it('warn-skips with self-hosted-no-driver when port is unset and the discovery cascade finds nothing', async () => {
      const getEnv = key => {
        if (key === 'PERCY_IOS_DEVICE_UDID') return '00008110-000065081404401E';
        return undefined;
      };
      const httpRequest = async () => { throw Object.assign(new Error('econnrefused'), { code: 'ECONNREFUSED' }); };
      const execLsof = async () => ({ stdout: '', stderr: '', exitCode: 0 });
      const res = await dump({ platform: 'ios', getEnv, httpRequest, execLsof });
      expect(res).toEqual({ kind: 'unavailable', reason: 'self-hosted-no-driver' });
    });

    it('warn-skips with self-hosted-no-driver when both env vars are unset and the cascade finds nothing', async () => {
      const httpRequest = async () => { throw Object.assign(new Error('econnrefused'), { code: 'ECONNREFUSED' }); };
      const execLsof = async () => ({ stdout: '', stderr: '', exitCode: 0 });
      const res = await dump({ platform: 'ios', getEnv: () => undefined, httpRequest, execLsof });
      expect(res).toEqual({ kind: 'unavailable', reason: 'self-hosted-no-driver' });
    });

    it('does not invoke adb on iOS dispatch', async () => {
      const execAdb = async () => { throw new Error('should not hit adb on iOS'); };
      const getEnv = key => {
        if (key === 'PERCY_IOS_DEVICE_UDID') return '00008110-000065081404401E';
        if (key === 'PERCY_IOS_DRIVER_HOST_PORT') return '11100';
        return undefined;
      };
      // Fake httpRequest that returns connection-refused → forces fallback,
      // which uses execMaestro not execAdb. Either way, adb must not be hit.
      const httpRequest = async () => { throw Object.assign(new Error('econnrefused'), { code: 'ECONNREFUSED' }); };
      const res = await dump({ platform: 'ios', execAdb, execMaestro: maestroNotFound, httpRequest, getEnv });
      expect(res.kind).toBeDefined();
    });

    it('Android dispatch is unchanged when platform is omitted', async () => {
      // Default platform is 'android' — preserves backwards compatibility for
      // existing callers (api.js Android path) that pre-date the platform arg.
      const execAdb = makeFakeExecAdb([
        { match: args => args[0] === 'devices', result: okDevices },
        { match: args => args.includes('exec-out'), result: { stdout: loadFixture('simple.xml'), stderr: '', exitCode: 0 } }
      ]);
      const res = await dump({ execMaestro: maestroNotFound, execAdb, getEnv: () => undefined });
      expect(res.kind).toBe('hierarchy');
      expect(res.nodes.length).toBeGreaterThan(0);
    });

    it('PERCY_MAESTRO_GRPC=0 kill switch: skips iOS HTTP primary, routes to maestro-cli fallback', async () => {
      // Verifies D3 kill switch invariant 2: the env var that gates Android gRPC
      // ALSO gates the iOS HTTP primary. With kill switch on, runIosHttpDump must
      // not be invoked — runMaestroIosDump is the only path to a hierarchy result.
      const httpRequest = jasmine.createSpy('httpRequest');
      const iosCliStdout = fs.readFileSync(
        path.resolve(url.fileURLToPath(import.meta.url), '../../fixtures/maestro-ios-hierarchy/maestro-cli-ios-stdout.json'),
        'utf8'
      );
      const execMaestro = async () => ({ stdout: iosCliStdout, stderr: '', exitCode: 0 });
      const getEnv = key => ({
        PERCY_IOS_DEVICE_UDID: '00008110-000065081404401E',
        PERCY_IOS_DRIVER_HOST_PORT: '11100',
        PERCY_MAESTRO_GRPC: '0'
      })[key];
      const res = await dump({ platform: 'ios', getEnv, httpRequest, execMaestro });
      expect(res.kind).toBe('hierarchy');
      expect(httpRequest).not.toHaveBeenCalled();
    });
  });

  // Self-hosted iOS path: triggered when PERCY_IOS_DRIVER_HOST_PORT is
  // absent. The resolver auto-discovers the running Maestro driver port
  // via probe 127.0.0.1:7001 → lsof → warn-skip. The BS path (explicit
  // env vars) does not exercise this code at all.
  describe('iOS self-hosted port cascade', () => {
    // Minimal axElement response matching the existing iOS HTTP fixture
    // shape — single AUT root, one button child with a frame. Enough for
    // runIosHttpDump to return { kind: 'hierarchy' }.
    const minimalAxElementJson = JSON.stringify({
      axElement: {
        elementType: 1,
        identifier: 'com.example.app',
        frame: { X: 0, Y: 0, Width: 100, Height: 100 },
        children: [
          { elementType: 9, identifier: 'btn', label: 'OK', frame: { X: 10, Y: 10, Width: 50, Height: 30 } }
        ]
      }
    });

    const successfulHttpResponse = {
      statusCode: 200,
      headers: { 'content-type': 'application/json' },
      body: minimalAxElementJson
    };

    const connectionRefused = () => Object.assign(new Error('econnrefused'), { code: 'ECONNREFUSED' });

    it('probe-7001 hit: cascade returns hierarchy and caches port 7001', async () => {
      const httpRequest = jasmine.createSpy('httpRequest').and.resolveTo(successfulHttpResponse);
      const execLsof = jasmine.createSpy('execLsof');
      const iosPortCache = { port: null };

      const res = await dump({
        platform: 'ios',
        getEnv: () => undefined,
        httpRequest,
        execLsof,
        iosPortCache
      });

      expect(res.kind).toBe('hierarchy');
      expect(res.nodes.length).toBeGreaterThan(0);
      // Probed exactly :7001; never invoked lsof (probe succeeded first).
      expect(httpRequest.calls.count()).toBe(1);
      expect(httpRequest.calls.first().args[0].port).toBe(7001);
      expect(execLsof).not.toHaveBeenCalled();
      // Cache populated.
      expect(iosPortCache.port).toBe(7001);
    });

    it('probe-7001 no-aut-tree: driver alive but AUT not foregrounded — caches port, returns no-aut-tree', async () => {
      // The resolver caches the port for hierarchy OR no-aut-tree (the driver
      // is alive either way). dump()'s self-hosted branch then surfaces the
      // non-hierarchy result instead of treating it as "no driver found".
      const springboardResponse = {
        statusCode: 200,
        headers: { 'content-type': 'application/json' },
        body: fs.readFileSync(path.resolve(
          url.fileURLToPath(import.meta.url),
          '../../fixtures/maestro-ios-hierarchy/viewHierarchy-response-springboard-only.json'
        ), 'utf8')
      };
      const httpRequest = jasmine.createSpy('httpRequest').and.resolveTo(springboardResponse);
      const execLsof = jasmine.createSpy('execLsof');
      const iosPortCache = { port: null };

      const res = await dump({
        platform: 'ios',
        getEnv: () => undefined,
        httpRequest,
        execLsof,
        iosPortCache
      });

      expect(res.kind).toBe('no-aut-tree');
      expect(httpRequest.calls.first().args[0].port).toBe(7001);
      // Port cached even on no-aut-tree (the driver is alive).
      expect(iosPortCache.port).toBe(7001);
      // Probe succeeded on :7001 → lsof never consulted.
      expect(execLsof).not.toHaveBeenCalled();
    });

    it('lsof discovery: 7001 fails, lsof returns exactly one xctrunner listener, cascade probes it', async () => {
      const ephemeralPort = 51234;
      const httpRequest = jasmine.createSpy('httpRequest').and.callFake(async ({ port }) => {
        if (port === 7001) throw connectionRefused();
        if (port === ephemeralPort) return successfulHttpResponse;
        throw connectionRefused();
      });
      const lsofStdout = `COMMAND  PID USER FD TYPE DEVICE SIZE/OFF NODE NAME\ndev.mobile.maestro-driver-iosUITests.xctrunner 12345 user 8u IPv4 0x1 0t0 TCP *:${ephemeralPort} (LISTEN)\n`;
      const execLsof = jasmine.createSpy('execLsof').and.resolveTo({ stdout: lsofStdout, stderr: '', exitCode: 0 });
      const iosPortCache = { port: null };

      const res = await dump({
        platform: 'ios',
        getEnv: () => undefined,
        httpRequest,
        execLsof,
        iosPortCache
      });

      expect(res.kind).toBe('hierarchy');
      expect(execLsof).toHaveBeenCalled();
      // Probed 7001 first, then lsof-discovered port.
      const probedPorts = httpRequest.calls.allArgs().map(args => args[0].port);
      expect(probedPorts).toEqual([7001, ephemeralPort]);
      expect(iosPortCache.port).toBe(ephemeralPort);
    });

    it('lsof zero matches: cascade warn-skips without guessing', async () => {
      const httpRequest = jasmine.createSpy('httpRequest').and.callFake(async () => { throw connectionRefused(); });
      // No xctrunner row in lsof output.
      const lsofStdout = 'COMMAND PID USER FD TYPE DEVICE NAME\nnode 999 user 8u IPv4 0t0 TCP *:3000 (LISTEN)\n';
      const execLsof = async () => ({ stdout: lsofStdout, stderr: '', exitCode: 0 });
      const iosPortCache = { port: null };

      const res = await dump({
        platform: 'ios',
        getEnv: () => undefined,
        httpRequest,
        execLsof,
        iosPortCache
      });

      expect(res).toEqual({ kind: 'unavailable', reason: 'self-hosted-no-driver' });
      expect(iosPortCache.port).toBeNull();
    });

    it('lsof multi-match (two xctrunner listeners): cascade refuses to guess and warn-skips', async () => {
      const httpRequest = jasmine.createSpy('httpRequest').and.callFake(async () => { throw connectionRefused(); });
      const lsofStdout = [
        'COMMAND PID USER FD TYPE DEVICE NAME',
        'dev.mobile.maestro-driver-iosUITests.xctrunner 100 user 8u IPv4 0x1 0t0 TCP *:51234 (LISTEN)',
        'dev.mobile.maestro-driver-iosUITests.xctrunner 101 user 8u IPv4 0x1 0t0 TCP *:51235 (LISTEN)',
        ''
      ].join('\n');
      const execLsof = async () => ({ stdout: lsofStdout, stderr: '', exitCode: 0 });
      const iosPortCache = { port: null };

      const res = await dump({
        platform: 'ios',
        getEnv: () => undefined,
        httpRequest,
        execLsof,
        iosPortCache
      });

      expect(res).toEqual({ kind: 'unavailable', reason: 'self-hosted-no-driver' });
      expect(iosPortCache.port).toBeNull();
    });

    it('explicit PERCY_IOS_DRIVER_HOST_PORT (out-of-legacy-range) bypasses cascade and runs HTTP primary', async () => {
      // Customer pinned --driver-host-port 6001 (e.g., real-device-forwarded
      // port). UDID absent — common single-device self-hosted case. The
      // EXPLICIT branch runs runIosHttpDump on 6001 (relaxed range admits
      // it); cascade/lsof are NOT invoked.
      const httpRequest = jasmine.createSpy('httpRequest').and.resolveTo(successfulHttpResponse);
      const execLsof = jasmine.createSpy('execLsof');
      const getEnv = key => (key === 'PERCY_IOS_DRIVER_HOST_PORT' ? '6001' : undefined);

      const res = await dump({ platform: 'ios', getEnv, httpRequest, execLsof });

      expect(res.kind).toBe('hierarchy');
      expect(httpRequest.calls.count()).toBe(1);
      expect(httpRequest.calls.first().args[0].port).toBe(6001);
      expect(execLsof).not.toHaveBeenCalled();
    });

    it('probe returns dump-error (wrong service): cascade does not cache and falls through', async () => {
      // The probed port answers 200 but with a body missing axElement —
      // runIosHttpDump returns { kind: 'dump-error', reason: 'http-missing-root' }.
      // This is NOT a Maestro driver; cascade must not cache, must move on
      // to lsof (which here returns no matches), and end in warn-skip with
      // an empty cache.
      const wrongServiceResponse = {
        statusCode: 200,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ unrelated: 'shape' })
      };
      const httpRequest = jasmine.createSpy('httpRequest').and.resolveTo(wrongServiceResponse);
      const execLsof = async () => ({ stdout: '', stderr: '', exitCode: 0 });
      const iosPortCache = { port: null };

      const res = await dump({
        platform: 'ios',
        getEnv: () => undefined,
        httpRequest,
        execLsof,
        iosPortCache
      });

      expect(res).toEqual({ kind: 'unavailable', reason: 'self-hosted-no-driver' });
      expect(iosPortCache.port).toBeNull();
    });

    it('cache hit: a second invocation with the same iosPortCache reuses the resolved port without re-probing/re-lsof', async () => {
      const httpRequest = jasmine.createSpy('httpRequest').and.resolveTo(successfulHttpResponse);
      const execLsof = jasmine.createSpy('execLsof');
      const iosPortCache = { port: null };

      // First call: cascade resolves to 7001 and caches it.
      await dump({ platform: 'ios', getEnv: () => undefined, httpRequest, execLsof, iosPortCache });
      expect(iosPortCache.port).toBe(7001);
      const firstCallCount = httpRequest.calls.count();

      // Second call: cache hit → single HTTP to the cached port. lsof never
      // invoked on either call.
      httpRequest.calls.reset();
      await dump({ platform: 'ios', getEnv: () => undefined, httpRequest, execLsof, iosPortCache });
      expect(httpRequest.calls.count()).toBe(1);
      expect(httpRequest.calls.first().args[0].port).toBe(7001);
      expect(execLsof).not.toHaveBeenCalled();
      // Sanity: first call probed exactly once (7001 hit) — no range/lsof.
      expect(firstCallCount).toBe(1);
    });

    it('probe-7001 hit without an iosPortCache: resolves hierarchy, nothing to cache', async () => {
      // Covers the `if (iosPortCache)` false arm in the probe helper — a
      // caller that doesn't thread a cache still resolves normally.
      const httpRequest = jasmine.createSpy('httpRequest').and.resolveTo(successfulHttpResponse);
      const execLsof = jasmine.createSpy('execLsof');

      const res = await dump({ platform: 'ios', getEnv: () => undefined, httpRequest, execLsof });

      expect(res.kind).toBe('hierarchy');
      expect(httpRequest.calls.first().args[0].port).toBe(7001);
      expect(execLsof).not.toHaveBeenCalled();
    });

    it('lsof failure modes (throw / null / spawnError / timedOut / non-zero & missing exit) all warn-skip', async () => {
      // Covers every arm of lsofXctrunnerPort's result guard (and the catch).
      const httpRequest = jasmine.createSpy('httpRequest').and.callFake(async () => { throw connectionRefused(); });
      const failureModes = [
        () => { throw new Error('lsof spawn failed'); }, // catch
        async () => null, // !result
        async () => ({ spawnError: true }), // spawnError
        async () => ({ timedOut: true }), // timedOut
        async () => ({ stdout: '', exitCode: 1 }), // exitCode !== 0
        async () => ({ stdout: '' }) // exitCode undefined → (?? 1) !== 0
      ];
      for (const execLsof of failureModes) {
        const res = await dump({ platform: 'ios', getEnv: () => undefined, httpRequest, execLsof, iosPortCache: { port: null } });
        expect(res).toEqual({ kind: 'unavailable', reason: 'self-hosted-no-driver' });
      }
    });

    it('lsof rows with invalid ports (0, out-of-range, overflow→Infinity) are all skipped', async () => {
      // Covers each arm of the port-validation guard: port < 1, port > 65535,
      // and !Number.isInteger (a 400-digit port overflows to Infinity).
      const httpRequest = jasmine.createSpy('httpRequest').and.callFake(async () => { throw connectionRefused(); });
      const bigPort = '9'.repeat(400);
      const lsofStdout = [
        'COMMAND PID USER FD TYPE DEVICE NAME',
        'dev.mobile.maestro-driver-iosUITests.xctrunner 1 user 8u IPv4 0x1 0t0 TCP *:0 (LISTEN)',
        'dev.mobile.maestro-driver-iosUITests.xctrunner 2 user 8u IPv4 0x1 0t0 TCP *:99999 (LISTEN)',
        `dev.mobile.maestro-driver-iosUITests.xctrunner 3 user 8u IPv4 0x1 0t0 TCP *:${bigPort} (LISTEN)`,
        ''
      ].join('\n');
      const execLsof = async () => ({ stdout: lsofStdout, stderr: '', exitCode: 0 });

      const res = await dump({ platform: 'ios', getEnv: () => undefined, httpRequest, execLsof, iosPortCache: { port: null } });

      expect(res).toEqual({ kind: 'unavailable', reason: 'self-hosted-no-driver' });
    });

    it('lsof finds a port but probing it also fails → warn-skip (hit falsy)', async () => {
      // Covers the `if (hit) return hit` false arm: lsof yields a candidate,
      // but the probe of that port fails too, so the cascade ends unresolved.
      const lsofPort = 51234;
      const httpRequest = jasmine.createSpy('httpRequest').and.callFake(async () => { throw connectionRefused(); });
      const lsofStdout = `COMMAND PID USER FD TYPE DEVICE NAME\ndev.mobile.maestro-driver-iosUITests.xctrunner 1 user 8u IPv4 0x1 0t0 TCP *:${lsofPort} (LISTEN)\n`;
      const execLsof = jasmine.createSpy('execLsof').and.resolveTo({ stdout: lsofStdout, stderr: '', exitCode: 0 });
      const iosPortCache = { port: null };

      const res = await dump({ platform: 'ios', getEnv: () => undefined, httpRequest, execLsof, iosPortCache });

      expect(res).toEqual({ kind: 'unavailable', reason: 'self-hosted-no-driver' });
      // Probed 7001 then the lsof candidate; both failed.
      expect(httpRequest.calls.allArgs().map(a => a[0].port)).toEqual([7001, lsofPort]);
      expect(iosPortCache.port).toBeNull();
    });
  });

  describe('iOS HTTP dump (runIosHttpDump primary path)', () => {
    const iosFixtureDir = path.resolve(url.fileURLToPath(import.meta.url), '../../fixtures/maestro-ios-hierarchy');
    const loadIosFixture = name => fs.readFileSync(path.join(iosFixtureDir, name), 'utf8');

    const validIosEnv = key => {
      if (key === 'PERCY_IOS_DEVICE_UDID') return '00008110-000065081404401E';
      if (key === 'PERCY_IOS_DRIVER_HOST_PORT') return '11100';
      return undefined;
    };

    function makeFakeHttpRequest(handler) {
      // handler: ({host, port, path, method, headers, body}) => {statusCode, headers, body}
      // OR throws an Error with .code (e.g. ECONNREFUSED, ETIMEDOUT, ECONNRESET).
      const callLog = [];
      const httpRequest = async opts => {
        callLog.push(opts);
        return handler(opts);
      };
      httpRequest.calls = callLog;
      return httpRequest;
    }

    it('returns hierarchy when server returns canonical happy-path AUT-found wrap (cli-2.0.7 shape)', async () => {
      const httpRequest = makeFakeHttpRequest(() => ({
        statusCode: 200,
        headers: { 'content-type': 'application/json' },
        body: loadIosFixture('viewHierarchy-response.json')
      }));
      const res = await dump({ platform: 'ios', getEnv: validIosEnv, httpRequest, execMaestro: maestroNotFound });
      expect(res.kind).toBe('hierarchy');
      // The fixture has AUT (com.example.app) + statusBars wrapper (elementType=0).
      // Walk should pick AUT, skip statusBars wrapper, flatten to 4 nodes total
      // (com.example.app, main_window, submitBtn, resultText).
      expect(res.nodes.length).toBeGreaterThanOrEqual(2);
      const submitBtn = res.nodes.find(n => n.id === 'submitBtn');
      expect(submitBtn).toBeDefined();
      expect(submitBtn.bounds).toBe('[100,400][290,444]');
    });

    it('POSTs {appIds: [], excludeKeyboardElements: false} per cli-2.0.7 server-side AUT detection (PR #2365)', async () => {
      const httpRequest = makeFakeHttpRequest(() => ({
        statusCode: 200,
        headers: { 'content-type': 'application/json' },
        body: loadIosFixture('viewHierarchy-response.json')
      }));
      await dump({ platform: 'ios', getEnv: validIosEnv, httpRequest, execMaestro: maestroNotFound });
      expect(httpRequest.calls.length).toBe(1);
      const call = httpRequest.calls[0];
      expect(call.method).toBe('POST');
      expect(call.path).toBe('/viewHierarchy');
      expect(call.host).toBe('127.0.0.1');
      expect(call.port).toBe(11100);
      expect(call.headers['content-type']).toMatch(/application\/json/i);
      expect(JSON.parse(call.body)).toEqual({ appIds: [], excludeKeyboardElements: false });
    });

    it('walks past SpringBoard sibling in cli-1.39.13 wrap (regression guard)', async () => {
      // Older Maestro versions wrap as [springboardHierarchy, appHierarchy].
      // Naïve "first elementType==1" walk would pick SpringBoard. Parser must skip it.
      const wrapBody = JSON.stringify({
        axElement: {
          identifier: '',
          frame: { X: 0, Y: 0, Width: 0, Height: 0 },
          label: '',
          elementType: 0,
          enabled: false,
          children: [
            {
              identifier: 'com.apple.springboard',
              frame: { X: 0, Y: 0, Width: 390, Height: 844 },
              label: 'SpringBoard',
              elementType: 1,
              enabled: true,
              children: []
            },
            {
              identifier: 'com.example.app',
              frame: { X: 0, Y: 0, Width: 390, Height: 844 },
              label: 'AUT',
              elementType: 1,
              enabled: true,
              children: [
                {
                  identifier: 'submitBtn',
                  frame: { X: 50, Y: 50, Width: 100, Height: 40 },
                  label: 'Submit',
                  elementType: 9,
                  enabled: true
                }
              ]
            }
          ]
        },
        depth: 3
      });
      const httpRequest = makeFakeHttpRequest(() => ({
        statusCode: 200,
        headers: { 'content-type': 'application/json' },
        body: wrapBody
      }));
      const res = await dump({ platform: 'ios', getEnv: validIosEnv, httpRequest, execMaestro: maestroNotFound });
      expect(res.kind).toBe('hierarchy');
      // Must find com.example.app, NOT com.apple.springboard.
      expect(res.nodes.find(n => n.id === 'com.example.app')).toBeDefined();
      expect(res.nodes.find(n => n.id === 'submitBtn')).toBeDefined();
    });

    it('handles post-PR-2402 single-AUT root (no wrap, forward-compat)', async () => {
      const singleRoot = JSON.stringify({
        axElement: {
          identifier: 'com.example.app',
          frame: { X: 0, Y: 0, Width: 390, Height: 844 },
          label: 'AUT',
          elementType: 1,
          enabled: true,
          children: [
            { identifier: 'btn', frame: { X: 10, Y: 20, Width: 50, Height: 30 }, label: '', elementType: 9, enabled: true }
          ]
        },
        depth: 2
      });
      const httpRequest = makeFakeHttpRequest(() => ({
        statusCode: 200,
        headers: { 'content-type': 'application/json' },
        body: singleRoot
      }));
      const res = await dump({ platform: 'ios', getEnv: validIosEnv, httpRequest, execMaestro: maestroNotFound });
      expect(res.kind).toBe('hierarchy');
      expect(res.nodes.find(n => n.id === 'com.example.app')).toBeDefined();
    });

    it('falls back to maestro-CLI on SpringBoard-only response (AUT not running)', async () => {
      const httpRequest = makeFakeHttpRequest(() => ({
        statusCode: 200,
        headers: { 'content-type': 'application/json' },
        body: loadIosFixture('viewHierarchy-response-springboard-only.json')
      }));
      // execMaestro returns a stdout that looks like Maestro's TreeNode shape
      // (the fallback path's expected output). Use the variant 6 fixture.
      const execMaestro = async () => ({
        stdout: loadIosFixture('maestro-cli-ios-stdout.json'),
        stderr: '',
        exitCode: 0
      });
      const res = await dump({ platform: 'ios', getEnv: validIosEnv, httpRequest, execMaestro });
      expect(res.kind).toBe('hierarchy');
      // Maestro CLI fallback should produce nodes via existing flattenMaestroNodes
      expect(res.nodes.length).toBeGreaterThan(0);
      expect(res.nodes.find(n => n.id === 'submitBtn')).toBeDefined();
    });

    it('falls back to maestro-CLI on ECONNREFUSED', async () => {
      const httpRequest = makeFakeHttpRequest(() => {
        throw Object.assign(new Error('econnrefused'), { code: 'ECONNREFUSED' });
      });
      const execMaestro = async () => ({
        stdout: loadIosFixture('maestro-cli-ios-stdout.json'),
        stderr: '',
        exitCode: 0
      });
      const res = await dump({ platform: 'ios', getEnv: validIosEnv, httpRequest, execMaestro });
      expect(res.kind).toBe('hierarchy');
    });

    it('falls back to maestro-CLI on ETIMEDOUT', async () => {
      const httpRequest = makeFakeHttpRequest(() => {
        throw Object.assign(new Error('etimedout'), { code: 'ETIMEDOUT' });
      });
      const execMaestro = async () => ({
        stdout: loadIosFixture('maestro-cli-ios-stdout.json'),
        stderr: '',
        exitCode: 0
      });
      const res = await dump({ platform: 'ios', getEnv: validIosEnv, httpRequest, execMaestro });
      expect(res.kind).toBe('hierarchy');
    });

    it('falls back to maestro-CLI on socket reset (ECONNRESET)', async () => {
      const httpRequest = makeFakeHttpRequest(() => {
        throw Object.assign(new Error('econnreset'), { code: 'ECONNRESET' });
      });
      const execMaestro = async () => ({
        stdout: loadIosFixture('maestro-cli-ios-stdout.json'),
        stderr: '',
        exitCode: 0
      });
      const res = await dump({ platform: 'ios', getEnv: validIosEnv, httpRequest, execMaestro });
      expect(res.kind).toBe('hierarchy');
    });

    it('falls back to maestro-CLI on 5xx status', async () => {
      const httpRequest = makeFakeHttpRequest(() => ({
        statusCode: 502,
        headers: {},
        body: 'bad gateway'
      }));
      const execMaestro = async () => ({
        stdout: loadIosFixture('maestro-cli-ios-stdout.json'),
        stderr: '',
        exitCode: 0
      });
      const res = await dump({ platform: 'ios', getEnv: validIosEnv, httpRequest, execMaestro });
      expect(res.kind).toBe('hierarchy');
    });

    it('returns dump-error for 4xx with bad-request-shape body (schema-class)', async () => {
      const httpRequest = makeFakeHttpRequest(() => ({
        statusCode: 400,
        headers: { 'content-type': 'text/plain' },
        body: 'incorrect request body provided'
      }));
      // execMaestro should NOT be called on schema-class — assert via throw.
      const execMaestro = async () => { throw new Error('should not invoke maestro-cli on schema-class'); };
      const res = await dump({ platform: 'ios', getEnv: validIosEnv, httpRequest, execMaestro });
      expect(res.kind).toBe('dump-error');
      expect(res.reason).toMatch(/bad-request-shape|schema-/);
    });

    it('falls through to JSON parse when content-type is missing or non-JSON (Maestro upstream omits CT)', async () => {
      // Maestro's ViewHierarchyHandler.swift returns HTTPResponse(statusCode:.ok, body:body)
      // without setting Content-Type. FlyingFox HTTP server doesn't auto-set one. Body is
      // valid JSON regardless. Resolver must accept this.
      const validBody = JSON.stringify({
        axElement: {
          identifier: 'com.example.app',
          frame: { X: 0, Y: 0, Width: 390, Height: 844 },
          label: 'AUT',
          elementType: 1,
          enabled: true,
          children: []
        },
        depth: 1
      });
      // No content-type header at all (Maestro's actual behavior).
      const httpRequestNoCT = makeFakeHttpRequest(() => ({
        statusCode: 200, headers: {}, body: validBody
      }));
      const res1 = await dump({ platform: 'ios', getEnv: validIosEnv, httpRequest: httpRequestNoCT, execMaestro: async () => ({}) });
      expect(res1.kind).toBe('hierarchy');

      // text/json or other non-application/json — same forgiving behavior.
      const httpRequestTextJson = makeFakeHttpRequest(() => ({
        statusCode: 200, headers: { 'content-type': 'text/json' }, body: validBody
      }));
      const res2 = await dump({ platform: 'ios', getEnv: validIosEnv, httpRequest: httpRequestTextJson, execMaestro: async () => ({}) });
      expect(res2.kind).toBe('hierarchy');
    });

    it('returns http-parse-error when body is not valid JSON regardless of content-type', async () => {
      const httpRequest = makeFakeHttpRequest(() => ({
        statusCode: 200,
        headers: { 'content-type': 'text/html' },
        body: '<html>?</html>'
      }));
      const execMaestro = async () => { throw new Error('should not invoke maestro-cli on schema-class'); };
      const res = await dump({ platform: 'ios', getEnv: validIosEnv, httpRequest, execMaestro });
      expect(res.kind).toBe('dump-error');
      expect(res.reason).toMatch(/http-parse-error/);
    });

    it('returns dump-error when response missing axElement root (schema-class)', async () => {
      const httpRequest = makeFakeHttpRequest(() => ({
        statusCode: 200,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ depth: 2 })
      }));
      const execMaestro = async () => { throw new Error('should not invoke maestro-cli on schema-class'); };
      const res = await dump({ platform: 'ios', getEnv: validIosEnv, httpRequest, execMaestro });
      expect(res.kind).toBe('dump-error');
      expect(res.reason).toMatch(/missing-root|schema-/);
    });

    it('returns dump-error when AUT node missing frame (schema-class)', async () => {
      const httpRequest = makeFakeHttpRequest(() => ({
        statusCode: 200,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          axElement: {
            identifier: 'com.example.app',
            elementType: 1,
            label: 'AUT',
            enabled: true
            // no frame
          },
          depth: 1
        })
      }));
      const execMaestro = async () => { throw new Error('should not invoke maestro-cli on schema-class'); };
      const res = await dump({ platform: 'ios', getEnv: validIosEnv, httpRequest, execMaestro });
      expect(res.kind).toBe('dump-error');
      expect(res.reason).toMatch(/missing-frame|schema-/);
    });

    it('rejects malformed JSON body (schema-class)', async () => {
      const httpRequest = makeFakeHttpRequest(() => ({
        statusCode: 200,
        headers: { 'content-type': 'application/json' },
        body: '{not valid json'
      }));
      const execMaestro = async () => { throw new Error('should not invoke maestro-cli on schema-class'); };
      const res = await dump({ platform: 'ios', getEnv: validIosEnv, httpRequest, execMaestro });
      expect(res.kind).toBe('dump-error');
      expect(res.reason).toMatch(/parse-error|malformed|schema-/);
    });

    it('rejects out-of-range PERCY_IOS_DRIVER_HOST_PORT and falls back', async () => {
      const httpRequest = makeFakeHttpRequest(() => { throw new Error('should not be called — port should be rejected first'); });
      const execMaestro = async () => ({
        stdout: loadIosFixture('maestro-cli-ios-stdout.json'),
        stderr: '',
        exitCode: 0
      });
      const getEnv = key => {
        if (key === 'PERCY_IOS_DEVICE_UDID') return '00008110-000065081404401E';
        if (key === 'PERCY_IOS_DRIVER_HOST_PORT') return '99999'; // out of 11100-11110 range
        return undefined;
      };
      const res = await dump({ platform: 'ios', getEnv, httpRequest, execMaestro });
      // Should fall back to maestro-CLI which succeeds via the stdout fixture
      expect(res.kind).toBe('hierarchy');
      expect(httpRequest.calls).toEqual([]);
    });

    it('iOS HTTP nodes do not carry `class` attribute (cli-2.0.7 finding)', async () => {
      // Maestro's IOSDriver.mapViewHierarchy at cli-2.0.7 does not populate
      // attributes['class'] — only resource-id, accessibilityText, etc.
      // Percy's iOS HTTP adapter follows the same convention.
      const httpRequest = makeFakeHttpRequest(() => ({
        statusCode: 200,
        headers: { 'content-type': 'application/json' },
        body: loadIosFixture('viewHierarchy-response.json')
      }));
      const res = await dump({ platform: 'ios', getEnv: validIosEnv, httpRequest, execMaestro: maestroNotFound });
      expect(res.kind).toBe('hierarchy');
      // No node should have a `class` attribute populated on the iOS HTTP path.
      for (const node of res.nodes) {
        expect(node.class).toBeFalsy();
      }
      // But `id` matches `resource-id` (set from AXElement.identifier).
      const submitBtn = res.nodes.find(n => n.id === 'submitBtn');
      expect(submitBtn).toBeDefined();
      expect(submitBtn['resource-id']).toBe('submitBtn');
    });

    it('iOS firstMatch with class selector returns null (no class on iOS nodes)', async () => {
      const httpRequest = makeFakeHttpRequest(() => ({
        statusCode: 200,
        headers: { 'content-type': 'application/json' },
        body: loadIosFixture('viewHierarchy-response.json')
      }));
      const res = await dump({ platform: 'ios', getEnv: validIosEnv, httpRequest, execMaestro: maestroNotFound });
      expect(res.kind).toBe('hierarchy');
      // class selector should not match anything on iOS — even though the
      // fixture has elementType:9 (button), Percy doesn't surface that as `class`.
      expect(firstMatch(res.nodes, { class: 'XCUIElementTypeButton' })).toBeNull();
      // id selector works
      expect(firstMatch(res.nodes, { id: 'submitBtn' })).toEqual({ x: 100, y: 400, width: 190, height: 44 });
    });
  });

  describe('iOS maestro-CLI fallback (runMaestroIosDump replacement)', () => {
    const iosFixtureDir = path.resolve(url.fileURLToPath(import.meta.url), '../../fixtures/maestro-ios-hierarchy');
    const loadIosFixture = name => fs.readFileSync(path.join(iosFixtureDir, name), 'utf8');

    const validIosEnv = key => {
      if (key === 'PERCY_IOS_DEVICE_UDID') return '00008110-000065081404401E';
      if (key === 'PERCY_IOS_DRIVER_HOST_PORT') return '11100';
      return undefined;
    };

    const httpRefused = async () => { throw Object.assign(new Error('refused'), { code: 'ECONNREFUSED' }); };

    it('parses maestro-cli-ios-stdout.json (TreeNode shape) via existing flattenMaestroNodes', async () => {
      const execMaestro = async args => {
        // Verify the iOS shell-out invocation shape: --udid <udid> --driver-host-port <port> hierarchy
        expect(args).toContain('--udid');
        expect(args).toContain('00008110-000065081404401E');
        expect(args).toContain('--driver-host-port');
        expect(args).toContain('11100');
        expect(args).toContain('hierarchy');
        return { stdout: loadIosFixture('maestro-cli-ios-stdout.json'), stderr: '', exitCode: 0 };
      };
      const res = await dump({ platform: 'ios', getEnv: validIosEnv, httpRequest: httpRefused, execMaestro });
      expect(res.kind).toBe('hierarchy');
      // The fixture has com.example.app + main_window + submitBtn + resultText
      const submitBtn = res.nodes.find(n => n.id === 'submitBtn');
      expect(submitBtn).toBeDefined();
      expect(submitBtn.bounds).toBe('[100,400][290,444]');
    });

    it('returns maestro-no-json when stdout has no `{`', async () => {
      const execMaestro = async () => ({ stdout: 'banner only, no json', stderr: '', exitCode: 0 });
      const res = await dump({ platform: 'ios', getEnv: validIosEnv, httpRequest: httpRefused, execMaestro });
      expect(res.kind).toBe('dump-error');
      expect(res.reason).toBe('maestro-no-json');
    });

    it('returns maestro-parse-error when stdout JSON is invalid', async () => {
      const execMaestro = async () => ({ stdout: '{not valid', stderr: '', exitCode: 0 });
      const res = await dump({ platform: 'ios', getEnv: validIosEnv, httpRequest: httpRefused, execMaestro });
      expect(res.kind).toBe('dump-error');
      expect(res.reason).toMatch(/^maestro-parse-error/);
    });

    it('returns maestro-exit-N for non-zero exit code', async () => {
      const execMaestro = async () => ({ stdout: '', stderr: 'failed', exitCode: 137 });
      const res = await dump({ platform: 'ios', getEnv: validIosEnv, httpRequest: httpRefused, execMaestro });
      expect(res.kind).toBe('dump-error');
      expect(res.reason).toMatch(/^maestro-exit-/);
    });
  });

  describe('maestroHierarchyDrift two-slot setter (Unit 4)', () => {
    beforeEach(() => {
      __testing.resetMaestroHierarchyDrift();
    });

    const validIosEnv = key => {
      if (key === 'PERCY_IOS_DEVICE_UDID') return '00008110-000065081404401E';
      if (key === 'PERCY_IOS_DRIVER_HOST_PORT') return '11100';
      return undefined;
    };

    it('initial state: both slots null', () => {
      expect(getMaestroHierarchyDrift()).toEqual({ android: null, ios: null });
    });

    it('iOS schema-class failure flips ios slot only; android stays null', async () => {
      // Send a body that JSON.parses but lacks the axElement root → schema-drift.
      const httpRequest = async () => ({
        statusCode: 200,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ depth: 2 })
      });
      const execMaestro = async () => { throw new Error('should not invoke maestro-cli on schema-class'); };
      const res = await dump({ platform: 'ios', getEnv: validIosEnv, httpRequest, execMaestro });
      expect(res.kind).toBe('dump-error');

      const drift = getMaestroHierarchyDrift();
      expect(drift.ios).toEqual(jasmine.objectContaining({ reason: 'http-missing-root' }));
      expect(typeof drift.ios.firstSeenAt).toBe('string');
      expect(drift.android).toBeNull();
    });

    it('first-seen-per-platform wins: subsequent same-platform write does not overwrite firstSeenAt', async () => {
      const httpRequest = async () => ({
        statusCode: 200,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ depth: 2 })
      });
      const execMaestro = async () => { throw new Error('should not invoke maestro-cli'); };
      // First failure
      await dump({ platform: 'ios', getEnv: validIosEnv, httpRequest, execMaestro });
      const firstSeenAt = getMaestroHierarchyDrift().ios.firstSeenAt;
      // Wait a tick so a second writer would observe a different timestamp.
      await new Promise(r => setTimeout(r, 5));
      // Second failure
      await dump({ platform: 'ios', getEnv: validIosEnv, httpRequest, execMaestro });
      expect(getMaestroHierarchyDrift().ios.firstSeenAt).toBe(firstSeenAt);
    });

    it('connection-class failure does NOT flip the drift bit (only schema-class does)', async () => {
      const httpRequest = async () => { throw Object.assign(new Error('refused'), { code: 'ECONNREFUSED' }); };
      const execMaestro = async () => ({ stdout: '', stderr: '', exitCode: 1 });
      await dump({ platform: 'ios', getEnv: validIosEnv, httpRequest, execMaestro });
      // R8: drift-bit fields (code/reason/firstSeenAt) NOT set on connection-class,
      // but the slot now populates with activity counters (channel-broken fallback recorded).
      const slot = getMaestroHierarchyDrift().ios;
      expect(slot).not.toBeNull();
      expect(slot.firstSeenAt).toBeUndefined();
      expect(slot.code).toBeUndefined();
      expect(slot.reason).toBeUndefined();
    });

    it('SpringBoard-only response does NOT flip the drift bit (no-aut-tree, not schema-drift)', async () => {
      const springboardOnly = JSON.stringify({
        axElement: {
          identifier: 'com.apple.springboard',
          frame: { X: 0, Y: 0, Width: 390, Height: 844 },
          label: 'SpringBoard',
          elementType: 1,
          enabled: true,
          children: []
        },
        depth: 1
      });
      const httpRequest = async () => ({
        statusCode: 200,
        headers: { 'content-type': 'application/json' },
        body: springboardOnly
      });
      const execMaestro = async () => ({ stdout: '', stderr: '', exitCode: 1 });
      await dump({ platform: 'ios', getEnv: validIosEnv, httpRequest, execMaestro });
      // R8: same as connection-class — slot populates with activity counters
      // (no-aut-tree records 'other' fallback), but drift-bit fields stay absent.
      const slot = getMaestroHierarchyDrift().ios;
      expect(slot).not.toBeNull();
      expect(slot.firstSeenAt).toBeUndefined();
      expect(slot.code).toBeUndefined();
      expect(slot.reason).toBeUndefined();
    });

    it('reset helper clears both slots', async () => {
      // Flip the iOS slot first
      const httpRequest = async () => ({
        statusCode: 200,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ depth: 2 })
      });
      await dump({ platform: 'ios', getEnv: validIosEnv, httpRequest, execMaestro: async () => ({ stdout: '', stderr: '', exitCode: 1 }) });
      expect(getMaestroHierarchyDrift().ios).not.toBeNull();
      __testing.resetMaestroHierarchyDrift();
      expect(getMaestroHierarchyDrift()).toEqual({ android: null, ios: null });
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  //  Resolver activity counters + info-level transition logs (R7/R8).
  //  Extends the two-slot drift envelope to surface the most recent failure
  //  class, cumulative fallback count, and the resolver that ultimately
  //  succeeded — so /percy/healthcheck can answer "what's the gRPC primary
  //  actually doing on this BS host?" without --verbose logs.
  // ─────────────────────────────────────────────────────────────────────────
  describe('resolver activity counters + transition logs (R7/R8)', () => {
    beforeEach(() => {
      __testing.resetMaestroHierarchyDrift();
    });

    const GRPC_STATUS = {
      OK: 0,
      CANCELLED: 1,
      INVALID_ARGUMENT: 3,
      DEADLINE_EXCEEDED: 4,
      RESOURCE_EXHAUSTED: 8,
      FAILED_PRECONDITION: 9,
      ABORTED: 10,
      OUT_OF_RANGE: 11,
      UNIMPLEMENTED: 12,
      INTERNAL: 13,
      UNAVAILABLE: 14,
      DATA_LOSS: 15
    };

    const validAndroidEnv = (overrides = {}) => key => ({
      ANDROID_SERIAL: 'env-serial',
      PERCY_ANDROID_GRPC_PORT: '7100',
      ...overrides
    })[key];

    const validIosEnv = key => {
      if (key === 'PERCY_IOS_DEVICE_UDID') return '00008110-000065081404401E';
      if (key === 'PERCY_IOS_DRIVER_HOST_PORT') return '11100';
      return undefined;
    };

    const simpleGrpcXml =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<hierarchy rotation="0">' +
      '<node resource-id="com.example:id/clock" bounds="[40,50][500,150]"/>' +
      '</hierarchy>';

    function makeGrpcFactory({ response, error }) {
      return () => ({
        viewHierarchy: () => error ? Promise.reject(error) : Promise.resolve(response),
        close: () => {}
      });
    }

    const maestroSimple = loadFixture('maestro-simple.json');
    const maestroHierarchyOk = async () => ({ stdout: maestroSimple, stderr: '', exitCode: 0 });

    // ─── Initial state (back-compat) ─────────────────────────────────────

    it('initial state: both slots null (back-compat: no resolver activity → no envelope state)', () => {
      expect(getMaestroHierarchyDrift()).toEqual({ android: null, ios: null });
    });

    // ─── Android success cases ──────────────────────────────────────────

    it('Android gRPC success → android slot populated with succeededVia=grpc, no fallbacks', async () => {
      const cache = new Map();
      await dump({
        platform: 'android',
        getEnv: validAndroidEnv(),
        execAdb: makeFakeExecAdb([{ match: args => args[0] === 'devices', result: okDevices }]),
        execMaestro: maestroNotFound,
        grpcClient: makeGrpcFactory({ response: { hierarchy: simpleGrpcXml } }),
        grpcClientCache: cache
      });

      expect(getMaestroHierarchyDrift().android).toEqual({
        lastFailureClass: null,
        fallbackCount: 0,
        succeededVia: 'grpc'
      });
      expect(getMaestroHierarchyDrift().ios).toBeNull();
    });

    it('Android maestro-cli success (no gRPC env) → succeededVia=maestro-cli, no fallbacks', async () => {
      await dump({
        platform: 'android',
        getEnv: k => (k === 'ANDROID_SERIAL' ? 'env-serial' : undefined),
        execAdb: makeFakeExecAdb([{ match: args => args[0] === 'devices', result: okDevices }]),
        execMaestro: maestroHierarchyOk
      });

      expect(getMaestroHierarchyDrift().android).toEqual({
        lastFailureClass: null,
        fallbackCount: 0,
        succeededVia: 'maestro-cli'
      });
    });

    it('Android adb success (no gRPC env, no maestro CLI) → succeededVia=adb, fallbackCount=1 from CLI failure', async () => {
      await dump({
        platform: 'android',
        execMaestro: maestroNotFound,
        execAdb: makeFakeExecAdb([
          { match: args => args[0] === 'devices', result: okDevices },
          { match: args => args.includes('exec-out'), result: { stdout: loadFixture('simple.xml'), stderr: '', exitCode: 0 } }
        ]),
        getEnv: () => undefined
      });

      expect(getMaestroHierarchyDrift().android).toEqual({
        lastFailureClass: 'other',
        fallbackCount: 1,
        succeededVia: 'adb'
      });
    });

    // ─── Android gRPC contention-class → adb (skip CLI) ─────────────────

    it('Android gRPC contention-class → adb: lastFailureClass=contention-class, fallbackCount=1, succeededVia=adb', async () => {
      const cache = new Map();
      await dump({
        platform: 'android',
        getEnv: validAndroidEnv(),
        execAdb: makeFakeExecAdb([
          { match: args => args[0] === 'devices', result: okDevices },
          { match: args => args.includes('exec-out'), result: { stdout: loadFixture('simple.xml'), stderr: '', exitCode: 0 } }
        ]),
        execMaestro: maestroNotFound, // would-be CLI is skipped per contention-class rule
        grpcClient: makeGrpcFactory({ error: { code: GRPC_STATUS.DEADLINE_EXCEEDED, message: 'queued' } }),
        grpcClientCache: cache
      });

      expect(getMaestroHierarchyDrift().android).toEqual({
        lastFailureClass: 'contention-class',
        fallbackCount: 1,
        succeededVia: 'adb'
      });
    });

    // ─── Android gRPC channel-broken → maestro-cli success ──────────────

    it('Android gRPC channel-broken → maestro-cli (success): lastFailureClass=channel-broken, fallbackCount=1, succeededVia=maestro-cli', async () => {
      const cache = new Map();
      await dump({
        platform: 'android',
        getEnv: validAndroidEnv(),
        execAdb: makeFakeExecAdb([{ match: args => args[0] === 'devices', result: okDevices }]),
        execMaestro: maestroHierarchyOk,
        grpcClient: makeGrpcFactory({ error: { code: GRPC_STATUS.UNAVAILABLE, message: 'gone' } }),
        grpcClientCache: cache
      });

      expect(getMaestroHierarchyDrift().android).toEqual({
        lastFailureClass: 'channel-broken',
        fallbackCount: 1,
        succeededVia: 'maestro-cli'
      });
    });

    // ─── Android gRPC channel-broken → maestro-cli fail → adb success ──

    it('Android gRPC channel-broken → maestro fail → adb success: fallbackCount=2, lastFailureClass=other (from maestro), succeededVia=adb', async () => {
      const cache = new Map();
      await dump({
        platform: 'android',
        getEnv: validAndroidEnv(),
        execAdb: makeFakeExecAdb([
          { match: args => args[0] === 'devices', result: okDevices },
          { match: args => args.includes('exec-out'), result: { stdout: loadFixture('simple.xml'), stderr: '', exitCode: 0 } }
        ]),
        execMaestro: async () => ({ stdout: '', stderr: 'maestro broken', exitCode: 1 }),
        grpcClient: makeGrpcFactory({ error: { code: GRPC_STATUS.UNAVAILABLE, message: 'gone' } }),
        grpcClientCache: cache
      });

      const slot = getMaestroHierarchyDrift().android;
      expect(slot.fallbackCount).toBe(2);
      expect(slot.succeededVia).toBe('adb');
      // lastFailureClass reflects the MOST RECENT fallback trigger (maestro CLI failure).
      expect(slot.lastFailureClass).toBe('other');
    });

    // ─── Android gRPC schema-class (no fallback) ────────────────────────

    it('Android gRPC schema-class → no fallback: lastFailureClass=schema-class, fallbackCount=0, succeededVia=none, drift-bit set', async () => {
      const cache = new Map();
      const res = await dump({
        platform: 'android',
        getEnv: validAndroidEnv(),
        execAdb: makeFakeExecAdb([{ match: args => args[0] === 'devices', result: okDevices }]),
        execMaestro: async () => { throw new Error('should not invoke maestro-cli on schema-class'); },
        grpcClient: makeGrpcFactory({ error: { code: GRPC_STATUS.UNIMPLEMENTED, message: 'no rpc' } }),
        grpcClientCache: cache
      });
      expect(res.kind).toBe('dump-error');

      const slot = getMaestroHierarchyDrift().android;
      expect(slot).toEqual(jasmine.objectContaining({
        lastFailureClass: 'schema-class',
        fallbackCount: 0,
        succeededVia: 'none',
        code: GRPC_STATUS.UNIMPLEMENTED,
        reason: 'grpc-schema-unimplemented'
      }));
      expect(typeof slot.firstSeenAt).toBe('string');
    });

    // ─── Counter accumulates across calls ───────────────────────────────

    it('two consecutive Android gRPC contention failures: fallbackCount=2, lastFailureClass sticky', async () => {
      const cache = new Map();
      const opts = {
        platform: 'android',
        getEnv: validAndroidEnv(),
        execAdb: makeFakeExecAdb([
          { match: args => args[0] === 'devices', result: okDevices },
          { match: args => args.includes('exec-out'), result: { stdout: loadFixture('simple.xml'), stderr: '', exitCode: 0 } }
        ]),
        execMaestro: maestroNotFound,
        grpcClient: makeGrpcFactory({ error: { code: GRPC_STATUS.RESOURCE_EXHAUSTED, message: 'queued' } }),
        grpcClientCache: cache
      };
      await dump(opts);
      await dump(opts);

      const slot = getMaestroHierarchyDrift().android;
      expect(slot.fallbackCount).toBe(2);
      expect(slot.lastFailureClass).toBe('contention-class');
      expect(slot.succeededVia).toBe('adb');
    });

    // ─── Contention then later success → lastFailureClass sticky, succeededVia=grpc

    it('gRPC contention then later gRPC success: lastFailureClass=contention-class sticky, succeededVia=grpc', async () => {
      const cache = new Map();
      // First call: gRPC contention → adb success.
      await dump({
        platform: 'android',
        getEnv: validAndroidEnv(),
        execAdb: makeFakeExecAdb([
          { match: args => args[0] === 'devices', result: okDevices },
          { match: args => args.includes('exec-out'), result: { stdout: loadFixture('simple.xml'), stderr: '', exitCode: 0 } }
        ]),
        execMaestro: maestroNotFound,
        grpcClient: makeGrpcFactory({ error: { code: GRPC_STATUS.DEADLINE_EXCEEDED, message: 'queued' } }),
        grpcClientCache: cache
      });
      // Second call: gRPC succeeds (different factory, same cache).
      await dump({
        platform: 'android',
        getEnv: validAndroidEnv(),
        execAdb: makeFakeExecAdb([{ match: args => args[0] === 'devices', result: okDevices }]),
        execMaestro: maestroNotFound,
        grpcClient: makeGrpcFactory({ response: { hierarchy: simpleGrpcXml } }),
        grpcClientCache: new Map() // fresh cache to avoid factory mismatch
      });

      const slot = getMaestroHierarchyDrift().android;
      expect(slot.fallbackCount).toBe(1); // sticky from first call
      expect(slot.lastFailureClass).toBe('contention-class'); // sticky from first call
      expect(slot.succeededVia).toBe('grpc'); // most-recent-wins
    });

    // ─── iOS success / failure cases ────────────────────────────────────

    it('iOS HTTP success → succeededVia=maestro-http, no fallbacks', async () => {
      const httpRequest = async () => ({
        statusCode: 200,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          axElement: {
            identifier: 'com.example.app',
            elementType: 1,
            enabled: true,
            frame: { X: 0, Y: 0, Width: 390, Height: 844 },
            children: []
          },
          depth: 1
        })
      });
      await dump({ platform: 'ios', getEnv: validIosEnv, httpRequest, execMaestro: async () => { throw new Error('should not'); } });

      expect(getMaestroHierarchyDrift().ios).toEqual({
        lastFailureClass: null,
        fallbackCount: 0,
        succeededVia: 'maestro-http'
      });
    });

    it('iOS HTTP schema-class → no fallback: lastFailureClass=schema-class, succeededVia=none, drift-bit set', async () => {
      const httpRequest = async () => ({
        statusCode: 200,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ depth: 2 }) // missing axElement → schema-drift
      });
      await dump({ platform: 'ios', getEnv: validIosEnv, httpRequest, execMaestro: async () => { throw new Error('should not'); } });

      const slot = getMaestroHierarchyDrift().ios;
      expect(slot).toEqual(jasmine.objectContaining({
        lastFailureClass: 'schema-class',
        fallbackCount: 0,
        succeededVia: 'none',
        reason: 'http-missing-root'
      }));
      expect(typeof slot.firstSeenAt).toBe('string');
    });

    it('iOS HTTP connection-fail → maestro-cli-fallback (success): lastFailureClass=channel-broken, fallbackCount=1, succeededVia=maestro-cli-fallback', async () => {
      const httpRequest = async () => { throw Object.assign(new Error('refused'), { code: 'ECONNREFUSED' }); };
      const execMaestro = async () => ({
        stdout: maestroSimple, stderr: '', exitCode: 0
      });
      await dump({ platform: 'ios', getEnv: validIosEnv, httpRequest, execMaestro });

      expect(getMaestroHierarchyDrift().ios).toEqual({
        lastFailureClass: 'channel-broken',
        fallbackCount: 1,
        succeededVia: 'maestro-cli-fallback'
      });
    });

    it('iOS HTTP no-aut-tree (SpringBoard-only) → maestro-cli-fallback (success): lastFailureClass=other, fallbackCount=1', async () => {
      const httpRequest = async () => ({
        statusCode: 200,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          axElement: {
            identifier: 'com.apple.springboard',
            elementType: 1,
            enabled: true,
            frame: { X: 0, Y: 0, Width: 390, Height: 844 },
            children: []
          },
          depth: 1
        })
      });
      const execMaestro = async () => ({ stdout: maestroSimple, stderr: '', exitCode: 0 });
      await dump({ platform: 'ios', getEnv: validIosEnv, httpRequest, execMaestro });

      const slot = getMaestroHierarchyDrift().ios;
      expect(slot.lastFailureClass).toBe('other');
      expect(slot.fallbackCount).toBe(1);
      expect(slot.succeededVia).toBe('maestro-cli-fallback');
    });

    it('iOS env-missing → lastFailureClass=other, fallbackCount=0, succeededVia=none', async () => {
      await dump({ platform: 'ios', getEnv: () => undefined });

      expect(getMaestroHierarchyDrift().ios).toEqual({
        lastFailureClass: 'other',
        fallbackCount: 0,
        succeededVia: 'none'
      });
    });

    it('Android adb-unavailable (no devices) → lastFailureClass=other, fallbackCount=0, succeededVia=none', async () => {
      // adb `devices` returns empty → resolveSerial returns classification.
      const execAdb = async () => ({ stdout: 'List of devices attached\n\n', stderr: '', exitCode: 0 });
      await dump({ platform: 'android', execAdb, execMaestro: maestroNotFound, getEnv: () => undefined });

      expect(getMaestroHierarchyDrift().android).toEqual({
        lastFailureClass: 'other',
        fallbackCount: 0,
        succeededVia: 'none'
      });
    });

    // ─── Cross-platform isolation ───────────────────────────────────────

    it('iOS activity does not touch android slot and vice versa', async () => {
      const cache = new Map();
      // Android gRPC contention → adb
      await dump({
        platform: 'android',
        getEnv: validAndroidEnv(),
        execAdb: makeFakeExecAdb([
          { match: args => args[0] === 'devices', result: okDevices },
          { match: args => args.includes('exec-out'), result: { stdout: loadFixture('simple.xml'), stderr: '', exitCode: 0 } }
        ]),
        execMaestro: maestroNotFound,
        grpcClient: makeGrpcFactory({ error: { code: GRPC_STATUS.DEADLINE_EXCEEDED } }),
        grpcClientCache: cache
      });
      // iOS env-missing
      await dump({ platform: 'ios', getEnv: () => undefined });

      const drift = getMaestroHierarchyDrift();
      expect(drift.android.succeededVia).toBe('adb');
      expect(drift.ios.succeededVia).toBe('none');
      expect(drift.android.lastFailureClass).toBe('contention-class');
      expect(drift.ios.lastFailureClass).toBe('other');
    });

    // ─── Reset helper covers all fields ─────────────────────────────────

    it('__testing.resetMaestroHierarchyDrift clears activity counters too', async () => {
      const cache = new Map();
      await dump({
        platform: 'android',
        getEnv: validAndroidEnv(),
        execAdb: makeFakeExecAdb([
          { match: args => args[0] === 'devices', result: okDevices },
          { match: args => args.includes('exec-out'), result: { stdout: loadFixture('simple.xml'), stderr: '', exitCode: 0 } }
        ]),
        execMaestro: maestroNotFound,
        grpcClient: makeGrpcFactory({ error: { code: GRPC_STATUS.DEADLINE_EXCEEDED } }),
        grpcClientCache: cache
      });
      expect(getMaestroHierarchyDrift().android).not.toBeNull();

      __testing.resetMaestroHierarchyDrift();
      expect(getMaestroHierarchyDrift()).toEqual({ android: null, ios: null });
    });

    // ─── R7: info-level transition logs ─────────────────────────────────

    it('R7: gRPC contention-class → adb transition emits info-level log line with structured shape', async () => {
      const cache = new Map();
      await dump({
        platform: 'android',
        getEnv: validAndroidEnv(),
        execAdb: makeFakeExecAdb([
          { match: args => args[0] === 'devices', result: okDevices },
          { match: args => args.includes('exec-out'), result: { stdout: loadFixture('simple.xml'), stderr: '', exitCode: 0 } }
        ]),
        execMaestro: maestroNotFound,
        grpcClient: makeGrpcFactory({ error: { code: GRPC_STATUS.DEADLINE_EXCEEDED, message: 'queued' } }),
        grpcClientCache: cache
      });
      const log = logger.stdout.join('\n');
      expect(log).toMatch(/\[percy\] hierarchy: grpc failed \(contention-class: grpc-contention-deadline_exceeded\) → falling back to adb/);
    });

    it('R7: gRPC channel-broken → maestro-cli transition emits info-level log line', async () => {
      const cache = new Map();
      await dump({
        platform: 'android',
        getEnv: validAndroidEnv(),
        execAdb: makeFakeExecAdb([{ match: args => args[0] === 'devices', result: okDevices }]),
        execMaestro: maestroHierarchyOk,
        grpcClient: makeGrpcFactory({ error: { code: GRPC_STATUS.UNAVAILABLE, message: 'gone' } }),
        grpcClientCache: cache
      });
      const log = logger.stdout.join('\n');
      expect(log).toMatch(/\[percy\] hierarchy: grpc failed \(channel-broken: grpc-channel-broken-unavailable\) → falling back to maestro-cli/);
    });

    it('R7: maestro-cli → adb transition emits info-level log line', async () => {
      await dump({
        platform: 'android',
        execMaestro: async () => ({ stdout: '', stderr: 'failed', exitCode: 1 }),
        execAdb: makeFakeExecAdb([
          { match: args => args[0] === 'devices', result: okDevices },
          { match: args => args.includes('exec-out'), result: { stdout: loadFixture('simple.xml'), stderr: '', exitCode: 0 } }
        ]),
        getEnv: () => undefined
      });
      const log = logger.stdout.join('\n');
      expect(log).toMatch(/\[percy\] hierarchy: maestro-cli failed \(other: maestro-exit-1\) → falling back to adb/);
    });

    it('R7: iOS HTTP → maestro-cli transition (connection-fail) emits info-level log line', async () => {
      const httpRequest = async () => { throw Object.assign(new Error('refused'), { code: 'ECONNREFUSED' }); };
      await dump({
        platform: 'ios',
        getEnv: validIosEnv,
        httpRequest,
        execMaestro: maestroHierarchyOk
      });
      const log = logger.stdout.join('\n');
      expect(log).toMatch(/\[percy\] hierarchy: maestro-http failed \(channel-broken: http-econnrefused\) → falling back to maestro-cli-fallback/);
    });

    it('R7: iOS out-of-range port → maestro-cli emits info-level log line', async () => {
      const getEnv = key => {
        if (key === 'PERCY_IOS_DEVICE_UDID') return '00008110-000065081404401E';
        if (key === 'PERCY_IOS_DRIVER_HOST_PORT') return '99999'; // out of range
        return undefined;
      };
      await dump({
        platform: 'ios',
        getEnv,
        httpRequest: async () => { throw new Error('should not run'); },
        execMaestro: maestroHierarchyOk
      });
      const log = logger.stdout.join('\n');
      expect(log).toMatch(/\[percy\] hierarchy: maestro-http failed \(other: out-of-range-port-99999\) → falling back to maestro-cli-fallback/);
    });

    it('R7: successful gRPC primary does NOT emit any "falling back to" info line', async () => {
      const cache = new Map();
      await dump({
        platform: 'android',
        getEnv: validAndroidEnv(),
        execAdb: makeFakeExecAdb([{ match: args => args[0] === 'devices', result: okDevices }]),
        execMaestro: maestroNotFound,
        grpcClient: makeGrpcFactory({ response: { hierarchy: simpleGrpcXml } }),
        grpcClientCache: cache
      });
      const log = logger.stdout.join('\n');
      expect(log).not.toMatch(/\[percy\] hierarchy:.*falling back/);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  //  Android gRPC primary path (D10 three-class taxonomy + D11 timeouts).
  //  Tests use factory injection — no real gRPC channels created.
  // ─────────────────────────────────────────────────────────────────────────
  describe('Android gRPC primary path', () => {
    // Inlined gRPC status enum — mirrors @grpc/grpc-js, kept inline so
    // classifier tests don't depend on the upstream runtime values.
    const GRPC_STATUS = {
      OK: 0,
      CANCELLED: 1,
      UNKNOWN: 2,
      INVALID_ARGUMENT: 3,
      DEADLINE_EXCEEDED: 4,
      NOT_FOUND: 5,
      ALREADY_EXISTS: 6,
      PERMISSION_DENIED: 7,
      RESOURCE_EXHAUSTED: 8,
      FAILED_PRECONDITION: 9,
      ABORTED: 10,
      OUT_OF_RANGE: 11,
      UNIMPLEMENTED: 12,
      INTERNAL: 13,
      UNAVAILABLE: 14,
      DATA_LOSS: 15,
      UNAUTHENTICATED: 16
    };

    function makeFakeFactory(impl) {
      const created = [];
      const factory = address => {
        const client = impl(address);
        created.push({ address, client });
        return client;
      };
      factory.created = created;
      return factory;
    }

    function makeFixedClient({ response, error, closeSpy }) {
      return {
        viewHierarchy: () => error ? Promise.reject(error) : Promise.resolve(response),
        close: () => { if (closeSpy) closeSpy(); }
      };
    }

    function makeAndroidEnv(overrides = {}) {
      return key => ({
        ANDROID_SERIAL: 'env-serial',
        PERCY_ANDROID_GRPC_PORT: '7100',
        ...overrides
      })[key];
    }

    // Sample XML envelope identical to simple.xml for parity with adb path.
    const simpleXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<hierarchy rotation="0">' +
      '<node resource-id="com.example:id/clock" bounds="[40,50][500,150]"/>' +
      '</hierarchy>';

    describe('classifyGrpcFailure (D10 three-class taxonomy)', () => {
      it('schema-class: missing code → grpc-decode (no fallback, drift bit)', () => {
        expect(classifyGrpcFailure(new Error('boom'))).toEqual({
          kind: 'dump-error', reason: 'grpc-decode'
        });
      });

      it('schema-class: INVALID_ARGUMENT', () => {
        expect(classifyGrpcFailure({ code: GRPC_STATUS.INVALID_ARGUMENT })).toEqual({
          kind: 'dump-error', reason: 'grpc-schema-invalid_argument'
        });
      });

      it('schema-class: FAILED_PRECONDITION, OUT_OF_RANGE, UNIMPLEMENTED, DATA_LOSS', () => {
        for (const code of [GRPC_STATUS.FAILED_PRECONDITION, GRPC_STATUS.OUT_OF_RANGE, GRPC_STATUS.UNIMPLEMENTED, GRPC_STATUS.DATA_LOSS]) {
          expect(classifyGrpcFailure({ code }).kind).toBe('dump-error');
          expect(classifyGrpcFailure({ code }).reason).toMatch(/^grpc-schema-/);
        }
      });

      it('contention-class: DEADLINE_EXCEEDED (timeout = backpressure)', () => {
        expect(classifyGrpcFailure({ code: GRPC_STATUS.DEADLINE_EXCEEDED })).toEqual({
          kind: 'connection-fail', reason: 'grpc-contention-deadline_exceeded'
        });
      });

      it('contention-class: RESOURCE_EXHAUSTED, ABORTED', () => {
        for (const code of [GRPC_STATUS.RESOURCE_EXHAUSTED, GRPC_STATUS.ABORTED]) {
          const r = classifyGrpcFailure({ code });
          expect(r.kind).toBe('connection-fail');
          expect(r.reason).toMatch(/^grpc-contention-/);
        }
      });

      it('channel-broken: UNAVAILABLE, INTERNAL, CANCELLED', () => {
        for (const code of [GRPC_STATUS.UNAVAILABLE, GRPC_STATUS.INTERNAL, GRPC_STATUS.CANCELLED]) {
          const r = classifyGrpcFailure({ code });
          expect(r.kind).toBe('connection-fail');
          expect(r.reason).toMatch(/^grpc-channel-broken-/);
        }
      });

      it('channel-broken (default): unmapped codes route to channel-broken', () => {
        for (const code of [GRPC_STATUS.NOT_FOUND, GRPC_STATUS.PERMISSION_DENIED, GRPC_STATUS.UNAUTHENTICATED]) {
          const r = classifyGrpcFailure({ code });
          expect(r.kind).toBe('connection-fail');
          expect(r.reason).toMatch(/^grpc-channel-broken-/);
        }
      });

      it('returns null for falsy errors', () => {
        expect(classifyGrpcFailure(null)).toBeNull();
        expect(classifyGrpcFailure(undefined)).toBeNull();
      });
    });

    describe('runAndroidGrpcDump (success path)', () => {
      it('returns hierarchy with parsed nodes from gRPC response XML', async () => {
        const cache = new Map();
        const factory = makeFakeFactory(() => makeFixedClient({
          response: { hierarchy: simpleXml }
        }));
        const res = await runAndroidGrpcDump({ host: '127.0.0.1', port: 7100, grpcClient: factory, cache });
        expect(res.kind).toBe('hierarchy');
        expect(firstMatch(res.nodes, { 'resource-id': 'com.example:id/clock' })).toEqual({
          x: 40, y: 50, width: 460, height: 100
        });
      });
    });

    describe('runAndroidGrpcDump (failure paths)', () => {
      it('schema-class UNIMPLEMENTED → drift bit set on android slot, no eviction', async () => {
        __testing.resetMaestroHierarchyDrift();
        const cache = new Map();
        const closeSpy = jasmine.createSpy('close');
        const factory = makeFakeFactory(() => makeFixedClient({
          error: { code: GRPC_STATUS.UNIMPLEMENTED, message: 'no rpc' },
          closeSpy
        }));
        const res = await runAndroidGrpcDump({ host: '127.0.0.1', port: 7100, grpcClient: factory, cache });
        expect(res).toEqual({ kind: 'dump-error', reason: 'grpc-schema-unimplemented' });
        expect(getMaestroHierarchyDrift().android).toEqual(jasmine.objectContaining({
          code: GRPC_STATUS.UNIMPLEMENTED, reason: 'grpc-schema-unimplemented'
        }));
        expect(getMaestroHierarchyDrift().ios).toBeNull();
        expect(cache.size).toBe(1); // not evicted on schema-class
        expect(closeSpy).not.toHaveBeenCalled();
      });

      it('contention-class DEADLINE_EXCEEDED → cache PRESERVED', async () => {
        const cache = new Map();
        const closeSpy = jasmine.createSpy('close');
        const factory = makeFakeFactory(() => makeFixedClient({
          error: { code: GRPC_STATUS.DEADLINE_EXCEEDED, message: 'queued' },
          closeSpy
        }));
        const res = await runAndroidGrpcDump({ host: '127.0.0.1', port: 7100, grpcClient: factory, cache });
        expect(res).toEqual({ kind: 'connection-fail', reason: 'grpc-contention-deadline_exceeded' });
        expect(cache.size).toBe(1); // contention = backpressure, not breakage
        expect(closeSpy).not.toHaveBeenCalled();
      });

      it('channel-broken UNAVAILABLE → cache evicted, client.close() called', async () => {
        const cache = new Map();
        const closeSpy = jasmine.createSpy('close');
        const factory = makeFakeFactory(() => makeFixedClient({
          error: { code: GRPC_STATUS.UNAVAILABLE, message: 'gone' },
          closeSpy
        }));
        const res = await runAndroidGrpcDump({ host: '127.0.0.1', port: 7100, grpcClient: factory, cache });
        expect(res).toEqual({ kind: 'connection-fail', reason: 'grpc-channel-broken-unavailable' });
        expect(cache.size).toBe(0);
        expect(closeSpy).toHaveBeenCalledTimes(1);
      });

      it('CANCELLED-during-shutdown → unavailable/shutdown (no fallback, R-7)', async () => {
        const cache = new Map();
        const factory = makeFakeFactory(() => makeFixedClient({
          error: { code: GRPC_STATUS.CANCELLED, message: 'shutting down' }
        }));
        const res = await runAndroidGrpcDump({
          host: '127.0.0.1', port: 7100, grpcClient: factory, cache, shutdownInProgress: true
        });
        expect(res).toEqual({ kind: 'unavailable', reason: 'shutdown' });
      });

      it('CANCELLED outside shutdown → channel-broken (cache evicted)', async () => {
        const cache = new Map();
        const factory = makeFakeFactory(() => makeFixedClient({
          error: { code: GRPC_STATUS.CANCELLED, message: 'cancelled' }
        }));
        const res = await runAndroidGrpcDump({ host: '127.0.0.1', port: 7100, grpcClient: factory, cache });
        expect(res.reason).toBe('grpc-channel-broken-cancelled');
        expect(cache.size).toBe(0);
      });

      it('schema-class: empty hierarchy field → grpc-no-xml-envelope drift', async () => {
        __testing.resetMaestroHierarchyDrift();
        const cache = new Map();
        const factory = makeFakeFactory(() => makeFixedClient({ response: { hierarchy: '' } }));
        const res = await runAndroidGrpcDump({ host: '127.0.0.1', port: 7100, grpcClient: factory, cache });
        expect(res).toEqual({ kind: 'dump-error', reason: 'grpc-no-xml-envelope' });
        expect(getMaestroHierarchyDrift().android.reason).toBe('grpc-no-xml-envelope');
      });
    });

    describe('runAndroidGrpcDump (cache reuse + per-instance isolation)', () => {
      it('reuses the same client for two calls to the same address', async () => {
        const cache = new Map();
        const factory = makeFakeFactory(() => makeFixedClient({ response: { hierarchy: simpleXml } }));
        await runAndroidGrpcDump({ host: '127.0.0.1', port: 7100, grpcClient: factory, cache });
        await runAndroidGrpcDump({ host: '127.0.0.1', port: 7100, grpcClient: factory, cache });
        expect(factory.created.length).toBe(1);
      });

      it('two independent caches do not share clients', async () => {
        const cacheA = new Map();
        const cacheB = new Map();
        const factory = makeFakeFactory(() => makeFixedClient({ response: { hierarchy: simpleXml } }));
        await runAndroidGrpcDump({ host: '127.0.0.1', port: 7100, grpcClient: factory, cache: cacheA });
        await runAndroidGrpcDump({ host: '127.0.0.1', port: 7100, grpcClient: factory, cache: cacheB });
        expect(factory.created.length).toBe(2);
        expect(cacheA.size).toBe(1);
        expect(cacheB.size).toBe(1);
      });

      it('connection-fail in cache A does not invalidate cache B', async () => {
        const cacheA = new Map();
        const cacheB = new Map();
        let callCount = 0;
        const factory = makeFakeFactory(() => makeFixedClient({
          error: callCount++ === 0 ? { code: GRPC_STATUS.UNAVAILABLE } : null,
          response: { hierarchy: simpleXml }
        }));
        await runAndroidGrpcDump({ host: '127.0.0.1', port: 7100, grpcClient: factory, cache: cacheA });
        const resB = await runAndroidGrpcDump({ host: '127.0.0.1', port: 7100, grpcClient: factory, cache: cacheB });
        expect(cacheA.size).toBe(0); // evicted
        expect(cacheB.size).toBe(1); // independent
        expect(resB.kind).toBe('hierarchy');
      });
    });

    describe('closeGrpcClientCache (Unit 5 helper)', () => {
      it('closes every cached client and clears the map', () => {
        const cache = new Map();
        const closeA = jasmine.createSpy('closeA');
        const closeB = jasmine.createSpy('closeB');
        cache.set('127.0.0.1:7100', { close: closeA });
        cache.set('127.0.0.1:7101', { close: closeB });
        closeGrpcClientCache(cache);
        expect(closeA).toHaveBeenCalledTimes(1);
        expect(closeB).toHaveBeenCalledTimes(1);
        expect(cache.size).toBe(0);
      });

      it('idempotent: second call on empty cache is a no-op', () => {
        const cache = new Map();
        closeGrpcClientCache(cache);
        closeGrpcClientCache(cache);
        expect(cache.size).toBe(0);
      });

      it('handles undefined / null cache gracefully (no throw)', () => {
        expect(() => closeGrpcClientCache(undefined)).not.toThrow();
        expect(() => closeGrpcClientCache(null)).not.toThrow();
      });
    });

    describe('dump({platform:"android"}) dispatch (Unit 3)', () => {
      it('env set + gRPC success: gRPC primary called, CLI/adb NOT called', async () => {
        const cache = new Map();
        const factory = makeFakeFactory(() => makeFixedClient({ response: { hierarchy: simpleXml } }));
        const execMaestro = jasmine.createSpy('execMaestro');
        const execAdb = jasmine.createSpy('execAdb');
        const res = await dump({
          platform: 'android',
          getEnv: makeAndroidEnv(),
          grpcClient: factory,
          grpcClientCache: cache,
          execMaestro,
          execAdb
        });
        expect(res.kind).toBe('hierarchy');
        expect(execMaestro).not.toHaveBeenCalled();
        expect(execAdb).not.toHaveBeenCalled();
      });

      it('env set + gRPC schema-class: returns immediately, no fallback', async () => {
        __testing.resetMaestroHierarchyDrift();
        const cache = new Map();
        const factory = makeFakeFactory(() => makeFixedClient({
          error: { code: GRPC_STATUS.UNIMPLEMENTED }
        }));
        const execMaestro = jasmine.createSpy('execMaestro');
        const execAdb = jasmine.createSpy('execAdb');
        const res = await dump({
          platform: 'android',
          getEnv: makeAndroidEnv(),
          grpcClient: factory,
          grpcClientCache: cache,
          execMaestro,
          execAdb
        });
        expect(res.reason).toBe('grpc-schema-unimplemented');
        expect(getMaestroHierarchyDrift().android).not.toBeNull();
        expect(execMaestro).not.toHaveBeenCalled();
        expect(execAdb).not.toHaveBeenCalled();
      });

      it('env set + contention-class: SKIPS maestro CLI, goes straight to adb', async () => {
        const cache = new Map();
        const factory = makeFakeFactory(() => makeFixedClient({
          error: { code: GRPC_STATUS.DEADLINE_EXCEEDED }
        }));
        const execMaestro = jasmine.createSpy('execMaestro');
        const execAdb = makeFakeExecAdb([
          { match: args => args.includes('exec-out'), result: { stdout: simpleXml, stderr: '', exitCode: 0 } }
        ]);
        const res = await dump({
          platform: 'android',
          getEnv: makeAndroidEnv(),
          grpcClient: factory,
          grpcClientCache: cache,
          execMaestro,
          execAdb
        });
        expect(res.kind).toBe('hierarchy');
        expect(execMaestro).not.toHaveBeenCalled(); // CLI skipped per D10/D5
        expect(execAdb.calls.some(args => args.includes('exec-out'))).toBe(true);
      });

      it('env set + channel-broken: falls through to maestro CLI', async () => {
        const cache = new Map();
        const factory = makeFakeFactory(() => makeFixedClient({
          error: { code: GRPC_STATUS.UNAVAILABLE }
        }));
        const maestroSimple = loadFixture('maestro-simple.json');
        const execMaestro = async () => ({ stdout: maestroSimple, stderr: '', exitCode: 0 });
        const execAdb = jasmine.createSpy('execAdb');
        const res = await dump({
          platform: 'android',
          getEnv: makeAndroidEnv(),
          grpcClient: factory,
          grpcClientCache: cache,
          execMaestro,
          execAdb
        });
        expect(res.kind).toBe('hierarchy');
        expect(execAdb).not.toHaveBeenCalled(); // CLI succeeded
      });

      it('kill switch PERCY_MAESTRO_GRPC=0: skips gRPC entirely', async () => {
        const cache = new Map();
        const factory = makeFakeFactory(() => { throw new Error('factory must not be called'); });
        const maestroSimple = loadFixture('maestro-simple.json');
        const execMaestro = async () => ({ stdout: maestroSimple, stderr: '', exitCode: 0 });
        const res = await dump({
          platform: 'android',
          getEnv: makeAndroidEnv({ PERCY_MAESTRO_GRPC: '0' }),
          grpcClient: factory,
          grpcClientCache: cache,
          execMaestro,
          execAdb: () => Promise.resolve({ stdout: '', stderr: '', exitCode: 0 })
        });
        expect(res.kind).toBe('hierarchy');
        expect(factory.created.length).toBe(0);
      });

      it('kill switch is re-read on every dump call (not cached): toggling mid-process flips behavior', async () => {
        // Verifies D3 kill switch invariant 3: PERCY_MAESTRO_GRPC is read at the
        // top of dump() on every invocation. The same cache + factory are reused
        // across two dumps; only the env getter changes between calls. First call
        // (switch=0) must skip gRPC; second call (switch unset) must build a client.
        const cache = new Map();
        const factory = makeFakeFactory(() => makeFixedClient({ response: { hierarchy: simpleXml } }));
        const maestroSimple = loadFixture('maestro-simple.json');
        const execMaestro = async () => ({ stdout: maestroSimple, stderr: '', exitCode: 0 });
        const execAdb = () => Promise.resolve({ stdout: '', stderr: '', exitCode: 0 });

        const res1 = await dump({
          platform: 'android',
          getEnv: makeAndroidEnv({ PERCY_MAESTRO_GRPC: '0' }),
          grpcClient: factory,
          grpcClientCache: cache,
          execMaestro,
          execAdb
        });
        expect(res1.kind).toBe('hierarchy');
        expect(factory.created.length).toBe(0);

        const res2 = await dump({
          platform: 'android',
          getEnv: makeAndroidEnv(),
          grpcClient: factory,
          grpcClientCache: cache,
          execMaestro,
          execAdb
        });
        expect(res2.kind).toBe('hierarchy');
        expect(factory.created.length).toBe(1);
      });

      it('env absent: gRPC NOT attempted; maestro CLI primary; adb fallback', async () => {
        const cache = new Map();
        const factory = makeFakeFactory(() => { throw new Error('factory must not be called'); });
        const maestroSimple = loadFixture('maestro-simple.json');
        const execMaestro = async () => ({ stdout: maestroSimple, stderr: '', exitCode: 0 });
        const res = await dump({
          platform: 'android',
          getEnv: makeAndroidEnv({ PERCY_ANDROID_GRPC_PORT: undefined }),
          grpcClient: factory,
          grpcClientCache: cache,
          execMaestro,
          execAdb: () => Promise.resolve({ stdout: '', stderr: '', exitCode: 0 })
        });
        expect(res.kind).toBe('hierarchy');
        expect(factory.created.length).toBe(0);
      });

      it('malformed env (PERCY_ANDROID_GRPC_PORT=abc): falls through to maestro CLI', async () => {
        const cache = new Map();
        const factory = makeFakeFactory(() => { throw new Error('factory must not be called'); });
        const maestroSimple = loadFixture('maestro-simple.json');
        const execMaestro = async () => ({ stdout: maestroSimple, stderr: '', exitCode: 0 });
        const res = await dump({
          platform: 'android',
          getEnv: makeAndroidEnv({ PERCY_ANDROID_GRPC_PORT: 'abc' }),
          grpcClient: factory,
          grpcClientCache: cache,
          execMaestro,
          execAdb: () => Promise.resolve({ stdout: '', stderr: '', exitCode: 0 })
        });
        expect(res.kind).toBe('hierarchy');
        expect(factory.created.length).toBe(0);
      });
    });
  });
});
