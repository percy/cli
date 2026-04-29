// Cross-platform parity test for the maestro-hierarchy resolver.
//
// Locks in the contract that both platform branches return the same external
// envelope shape, so future changes to one platform don't silently regress
// parity. Phase 1 (Unit 4) lands this test against the Android resolver and
// the iOS scaffolding stub. Phase 4 (post Phase 0.5 + Unit 2b) extends the
// iOS-side assertions to exercise real attribute mapping with a captured iOS
// hierarchy fixture at `cli/packages/core/test/unit/fixtures/maestro-hierarchy/ios-hierarchy-sample.json`.
//
// Reference: percy-maestro/docs/plans/2026-04-27-001-feat-ios-element-regions-maestro-hierarchy-plan.md
import fs from 'fs';
import path from 'path';
import url from 'url';
import {
  dump,
  firstMatch,
  SELECTOR_KEYS_WHITELIST,
  ANDROID_SELECTOR_KEYS_WHITELIST,
  IOS_SELECTOR_KEYS_WHITELIST
} from '../../src/maestro-hierarchy.js';
import { setupTest } from '../helpers/index.js';

const fixtureDir = path.resolve(url.fileURLToPath(import.meta.url), '../../fixtures/maestro-hierarchy');
const loadFixture = name => fs.readFileSync(path.join(fixtureDir, name), 'utf8');

const okDevices = {
  stdout: 'List of devices attached\nemulator-5554\tdevice\n\n',
  stderr: '',
  exitCode: 0
};

function makeFakeExecAdb(handlers) {
  return async args => {
    for (const { match, result } of handlers) {
      if (match(args)) return typeof result === 'function' ? result(args) : result;
    }
    throw new Error(`No fake handler matched: ${JSON.stringify(args)}`);
  };
}

const maestroNotFound = async () => ({ spawnError: Object.assign(new Error('not found'), { code: 'ENOENT' }) });

describe('Unit / maestro-hierarchy / cross-platform parity', () => {
  beforeEach(async () => {
    await setupTest();
  });

  describe('public API surface', () => {
    it('exports the cross-platform union whitelist', () => {
      // SELECTOR_KEYS_WHITELIST is the union — used by api.js handler-side validation.
      expect(SELECTOR_KEYS_WHITELIST).toEqual(jasmine.arrayWithExactContents([
        'resource-id', 'text', 'content-desc', 'class', 'id'
      ]));
    });

    it('exports per-platform whitelists for callers that want platform-scoped validation', () => {
      // Android keeps its existing vocabulary plus `id` as alias for resource-id (R1).
      expect(ANDROID_SELECTOR_KEYS_WHITELIST).toEqual(jasmine.arrayWithExactContents([
        'resource-id', 'text', 'content-desc', 'class', 'id'
      ]));
      // iOS V1 supports id and class only. text/xpath are V1.1.
      expect(IOS_SELECTOR_KEYS_WHITELIST).toEqual(jasmine.arrayWithExactContents([
        'id', 'class'
      ]));
    });

    it('union whitelist contains every per-platform whitelist key', () => {
      for (const key of ANDROID_SELECTOR_KEYS_WHITELIST) {
        expect(SELECTOR_KEYS_WHITELIST).toContain(key);
      }
      for (const key of IOS_SELECTOR_KEYS_WHITELIST) {
        expect(SELECTOR_KEYS_WHITELIST).toContain(key);
      }
    });
  });

  describe('envelope shape — both platforms return { kind, ... }', () => {
    it('Android success returns { kind: "hierarchy", nodes: [...] }', async () => {
      const execAdb = makeFakeExecAdb([
        { match: args => args[0] === 'devices', result: okDevices },
        { match: args => args.includes('exec-out'), result: { stdout: loadFixture('simple.xml'), stderr: '', exitCode: 0 } }
      ]);
      const res = await dump({ platform: 'android', execMaestro: maestroNotFound, execAdb, getEnv: () => undefined });
      expect(res.kind).toBe('hierarchy');
      expect(Array.isArray(res.nodes)).toBe(true);
      expect(res.nodes.length).toBeGreaterThan(0);
    });

    it('iOS env-missing returns { kind: "unavailable", reason: "env-missing" }', async () => {
      // Same envelope shape as Android-failure paths, just a different reason tag.
      const res = await dump({ platform: 'ios', getEnv: () => undefined });
      expect(res.kind).toBe('unavailable');
      expect(res.reason).toBe('env-missing');
    });

    it('iOS env-set returns { kind: "unavailable", reason: "not-implemented" } (Unit 2a stub)', async () => {
      const getEnv = key => {
        if (key === 'PERCY_IOS_DEVICE_UDID') return '00008110-X';
        if (key === 'PERCY_IOS_DRIVER_HOST_PORT') return '11100';
        return undefined;
      };
      const res = await dump({ platform: 'ios', getEnv });
      expect(res.kind).toBe('unavailable');
      expect(res.reason).toBe('not-implemented');
    });
  });

  describe('R1 vocabulary parity — `id` selector works on both platforms', () => {
    it('Android: `{id: X}` and `{resource-id: X}` resolve identical bbox', async () => {
      const execAdb = makeFakeExecAdb([
        { match: args => args[0] === 'devices', result: okDevices },
        { match: args => args.includes('exec-out'), result: { stdout: loadFixture('simple.xml'), stderr: '', exitCode: 0 } }
      ]);
      const res = await dump({ platform: 'android', execMaestro: maestroNotFound, execAdb, getEnv: () => undefined });

      const viaResourceId = firstMatch(res.nodes, { 'resource-id': 'com.example:id/clock' });
      const viaIdAlias = firstMatch(res.nodes, { id: 'com.example:id/clock' });
      expect(viaResourceId).not.toBeNull();
      expect(viaIdAlias).toEqual(viaResourceId);
    });

    it('iOS: `{id: X}` is in the whitelist (resolution path lands in Unit 2b)', () => {
      // The iOS branch of dump() is the Unit 2a stub; firstMatch contract is
      // ready to receive iOS nodes once Unit 2b populates them. Until then,
      // assert the public API accepts the iOS selector keys.
      expect(IOS_SELECTOR_KEYS_WHITELIST).toContain('id');
      expect(IOS_SELECTOR_KEYS_WHITELIST).toContain('class');
    });
  });

  describe('platform dispatch — caller contract is identical', () => {
    it('Android dispatch never reads iOS env vars', async () => {
      const observed = [];
      const getEnv = key => {
        observed.push(key);
        return undefined;
      };
      const execAdb = makeFakeExecAdb([
        { match: args => args[0] === 'devices', result: okDevices },
        { match: args => args.includes('exec-out'), result: { stdout: loadFixture('simple.xml'), stderr: '', exitCode: 0 } }
      ]);
      await dump({ platform: 'android', execMaestro: maestroNotFound, execAdb, getEnv });
      expect(observed).not.toContain('PERCY_IOS_DEVICE_UDID');
      expect(observed).not.toContain('PERCY_IOS_DRIVER_HOST_PORT');
    });

    it('iOS dispatch never reads Android env vars (ANDROID_SERIAL)', async () => {
      const observed = [];
      const getEnv = key => {
        observed.push(key);
        return undefined;
      };
      await dump({ platform: 'ios', getEnv });
      expect(observed).not.toContain('ANDROID_SERIAL');
    });

    it('iOS dispatch never invokes execAdb (no adb fallback on iOS)', async () => {
      let adbCalled = false;
      const execAdb = async () => { adbCalled = true; return {}; };
      await dump({
        platform: 'ios',
        execAdb,
        getEnv: key => ({ PERCY_IOS_DEVICE_UDID: 'X', PERCY_IOS_DRIVER_HOST_PORT: '11100' })[key]
      });
      expect(adbCalled).toBe(false);
    });

    it('Default platform (omitted) preserves Android backwards compatibility', async () => {
      // Pre-platform-arg callers (api.js historical Android path) call dump()
      // without { platform }. Must keep working — the default must be 'android'.
      const execAdb = makeFakeExecAdb([
        { match: args => args[0] === 'devices', result: okDevices },
        { match: args => args.includes('exec-out'), result: { stdout: loadFixture('simple.xml'), stderr: '', exitCode: 0 } }
      ]);
      const res = await dump({ execMaestro: maestroNotFound, execAdb, getEnv: () => undefined });
      expect(res.kind).toBe('hierarchy');
    });
  });
});
