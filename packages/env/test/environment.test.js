import PercyEnv from '@percy/env';

describe('PercyEnv', () => {
  describe('forcedPkgValue', () => {
    it('should return parsed JSON from PERCY_FORCE_PKG_VALUE', () => {
      let env = new PercyEnv({ PERCY_FORCE_PKG_VALUE: JSON.stringify({ name: '@percy/client', version: '1.0.0' }) });
      expect(env.forcedPkgValue).toEqual({ name: '@percy/client', version: '1.0.0' });
    });

    it('should return null if PERCY_FORCE_PKG_VALUE is not set', () => {
      let env = new PercyEnv({});
      expect(env.forcedPkgValue).toBeNull();
    });

    it('should return null if PERCY_FORCE_PKG_VALUE is invalid JSON', () => {
      let env = new PercyEnv({ PERCY_FORCE_PKG_VALUE: 'invalid' });
      expect(env.forcedPkgValue).toBeNull();
    });

    it('should return null if PERCY_FORCE_PKG_VALUE is null', () => {
      let env = new PercyEnv({ PERCY_FORCE_PKG_VALUE: null });
      expect(env.forcedPkgValue).toBeNull();
    });
  });

  describe('testhubBuildUuid', () => {
    it('should return TH_BUILD_UUID when it is set', () => {
      let env = new PercyEnv({ TH_BUILD_UUID: 'test_id' });
      expect(env.testhubBuildUuid).toEqual('test_id');
    });

    it('should return BROWSERSTACK_TESTHUB_UUID when TH_BUILD_UUID is not set', () => {
      let env = new PercyEnv({ BROWSERSTACK_TESTHUB_UUID: 'browserstack_id' });
      expect(env.testhubBuildUuid).toEqual('browserstack_id');
    });

    it('should prioritize TH_BUILD_UUID over BROWSERSTACK_TESTHUB_UUID when both are set', () => {
      let env = new PercyEnv({
        TH_BUILD_UUID: 'test_id',
        BROWSERSTACK_TESTHUB_UUID: 'browserstack_id'
      });
      expect(env.testhubBuildUuid).toEqual('test_id');
    });

    it('should return null if neither TH_BUILD_UUID nor BROWSERSTACK_TESTHUB_UUID are set', () => {
      let env = new PercyEnv({});
      expect(env.testhubBuildUuid).toBeNull();
    });

    it('should return null if both values are null', () => {
      let env = new PercyEnv({
        TH_BUILD_UUID: null,
        BROWSERSTACK_TESTHUB_UUID: null
      });
      expect(env.testhubBuildUuid).toBeNull();
    });
  });
});
