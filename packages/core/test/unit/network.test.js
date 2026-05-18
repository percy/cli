import { setupTest } from '../helpers/index.js';
import { Network, AbortCodes } from '../../src/network.js';
import { AbortError } from '../../src/utils.js';

describe('Unit / Network', () => {
  beforeEach(async () => {
    await setupTest();
  });

  afterEach(() => {
    process.env.PERCY_NETWORK_IDLE_WAIT_TIMEOUT = undefined;
  });

  // SC6 — concurrent pages with different PERCY_NETWORK_IDLE_WAIT_TIMEOUT
  // values must each see their own value. Pre-fix this was a static class
  // field so the second instance overwrote the first.
  describe('SC6: instance-scoped network-idle wait timeout', () => {
    it('initializes per-instance from env at construction time', () => {
      process.env.PERCY_NETWORK_IDLE_WAIT_TIMEOUT = '1234';
      let n1 = new Network({}, { userAgent: 'test' });

      process.env.PERCY_NETWORK_IDLE_WAIT_TIMEOUT = '5678';
      let n2 = new Network({}, { userAgent: 'test' });

      expect(n1.networkIdleWaitTimeout).toBe(1234);
      expect(n2.networkIdleWaitTimeout).toBe(5678);
    });

    it('falls back to 30000ms when env is unset or invalid', () => {
      process.env.PERCY_NETWORK_IDLE_WAIT_TIMEOUT = undefined;
      let n1 = new Network({}, { userAgent: 'test' });
      expect(n1.networkIdleWaitTimeout).toBe(30000);

      process.env.PERCY_NETWORK_IDLE_WAIT_TIMEOUT = 'not-a-number';
      let n2 = new Network({}, { userAgent: 'test' });
      expect(n2.networkIdleWaitTimeout).toBe(30000);
    });
  });

  // R5 — verify the exported AbortCodes contract.
  describe('R5: AbortCodes', () => {
    it('exports a frozen enum with the codes the network module throws', () => {
      expect(AbortCodes.ABORTED).toBe('ABORTED');
      expect(AbortCodes.TIMEOUT_NETWORK_IDLE).toBe('TIMEOUT_NETWORK_IDLE');
      expect(Object.isFrozen(AbortCodes)).toBe(true);
    });

    it('AbortError carries code and reason while keeping name=AbortError', () => {
      let err = new AbortError('msg', { code: AbortCodes.ABORTED, reason: 'browser-aborted' });
      expect(err.name).toBe('AbortError');
      expect(err.code).toBe('ABORTED');
      expect(err.reason).toBe('browser-aborted');
      expect(err.message).toBe('msg');
    });
  });
});
