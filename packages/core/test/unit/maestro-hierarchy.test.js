import fs from 'fs';
import path from 'path';
import url from 'url';
import { dump, firstMatch, getMaestroHierarchyDrift, __testing } from '../../src/maestro-hierarchy.js';
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
        execMaestro, execAdb,
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
    it('returns env-missing when PERCY_IOS_DEVICE_UDID is unset', async () => {
      const getEnv = key => {
        if (key === 'PERCY_IOS_DRIVER_HOST_PORT') return '11100';
        return undefined;
      };
      const res = await dump({ platform: 'ios', getEnv });
      expect(res).toEqual({ kind: 'unavailable', reason: 'env-missing' });
    });

    it('returns env-missing when PERCY_IOS_DRIVER_HOST_PORT is unset', async () => {
      const getEnv = key => {
        if (key === 'PERCY_IOS_DEVICE_UDID') return '00008110-000065081404401E';
        return undefined;
      };
      const res = await dump({ platform: 'ios', getEnv });
      expect(res).toEqual({ kind: 'unavailable', reason: 'env-missing' });
    });

    it('returns env-missing when both env vars are unset', async () => {
      const res = await dump({ platform: 'ios', getEnv: () => undefined });
      expect(res).toEqual({ kind: 'unavailable', reason: 'env-missing' });
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

    it('returns dump-error for non-JSON content-type (schema-class)', async () => {
      const httpRequest = makeFakeHttpRequest(() => ({
        statusCode: 200,
        headers: { 'content-type': 'text/html' },
        body: '<html>?</html>'
      }));
      const execMaestro = async () => { throw new Error('should not invoke maestro-cli on schema-class'); };
      const res = await dump({ platform: 'ios', getEnv: validIosEnv, httpRequest, execMaestro });
      expect(res.kind).toBe('dump-error');
      expect(res.reason).toMatch(/non-json-content-type|schema-/);
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
      expect(getMaestroHierarchyDrift().ios).toBeNull();
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
      expect(getMaestroHierarchyDrift().ios).toBeNull();
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
});
