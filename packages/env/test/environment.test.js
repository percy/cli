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
  });
});
