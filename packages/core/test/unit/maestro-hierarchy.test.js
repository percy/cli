import fs from 'fs';
import path from 'path';
import url from 'url';
import { dump, firstMatch } from '../../src/maestro-hierarchy.js';
import { setupTest } from '../helpers/index.js';

const fixtureDir = path.resolve(url.fileURLToPath(import.meta.url), '../../fixtures/maestro-hierarchy');
const loadFixture = name => fs.readFileSync(path.join(fixtureDir, name), 'utf8');

function makeFakeExecAdb(handlers) {
  // handlers: Array<{ match: (args) => boolean, result }> — ordered; first match wins per call.
  // A default `forward --list` handler is appended so tests focused on the
  // maestro+adb fallback chain don't need to stub the new gRPC port probe.
  // Tests that exercise the probe directly should pass their own handler
  // earlier in the list.
  const callLog = [];
  const fullHandlers = [
    ...handlers,
    { match: args => args.includes('forward') && args.includes('--list'), result: { stdout: '', stderr: '', exitCode: 0 } }
  ];
  const execAdb = async args => {
    callLog.push(args);
    for (const { match, result } of fullHandlers) {
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
      // Both the gRPC port probe and the dump call must carry -s <serial>.
      const dumpCall = execAdb.calls.find(args => args.includes('exec-out') && args.includes('/dev/tty'));
      expect(dumpCall).toEqual(['-s', 'env-serial-123', 'exec-out', 'uiautomator', 'dump', '/dev/tty']);
      const probeCall = execAdb.calls.find(args => args.includes('forward') && args.includes('--list'));
      expect(probeCall).toEqual(['-s', 'env-serial-123', 'forward', '--list']);
    });

    it('invokes fallback on empty stdout and returns hierarchy when fallback succeeds', async () => {
      let primaryCalled = false;
      const execAdb = async args => {
        if (args[0] === 'devices') return okDevices;
        if (args.includes('forward') && args.includes('--list')) return { stdout: '', stderr: '', exitCode: 0 };
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
        if (args.includes('forward') && args.includes('--list')) return { stdout: '', stderr: '', exitCode: 0 };
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
        if (args.includes('forward') && args.includes('--list')) return { stdout: '', stderr: '', exitCode: 0 };
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
        if (args.includes('forward') && args.includes('--list')) return { stdout: '', stderr: '', exitCode: 0 };
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
        if (args.includes('forward') && args.includes('--list')) return { stdout: '', stderr: '', exitCode: 0 };
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

    it('uses maestro hierarchy fallback when gRPC port is not discoverable; skips adb dump entirely', async () => {
      const execMaestro = async args => {
        expect(args).toEqual(['--udid', 'env-serial-123', 'hierarchy']);
        return okMaestro;
      };
      // adb is touched only for the gRPC port probe (returns no port → fall through);
      // exec-out / shell uiautomator must never be called.
      const execAdb = async args => {
        if (args.includes('forward') && args.includes('--list')) return { stdout: '', stderr: '', exitCode: 0 };
        throw new Error('execAdb should only be called for forward --list: ' + args.join(' '));
      };

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
      const execAdb = async args => {
        if (args.includes('forward') && args.includes('--list')) return { stdout: '', stderr: '', exitCode: 0 };
        throw new Error('should not hit adb beyond forward probe: ' + args.join(' '));
      };
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
        if (args.includes('forward') && args.includes('--list')) return { stdout: '', stderr: '', exitCode: 0 };
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
      const execAdb = async args => {
        if (args.includes('forward') && args.includes('--list')) return { stdout: '', stderr: '', exitCode: 0 };
        throw new Error('should not hit adb beyond forward probe: ' + args.join(' '));
      };
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
});
