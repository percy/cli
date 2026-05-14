import { setupTest } from '../helpers/index.js';
import { Network, AbortCodes, pickCookieSession, shouldAttachAuth, raceWithTimeout } from '../../src/network.js';
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

  // pickCookieSession — prefer the page's full Network domain, fall back to
  // the request's own session for worker/auxiliary paths.
  describe('pickCookieSession', () => {
    it('returns the page session when network.page.session is set', () => {
      let pageSession = { id: 'page' };
      let fallback = { id: 'fallback' };
      expect(pickCookieSession({ page: { session: pageSession } }, fallback)).toBe(pageSession);
    });

    it('falls back to the passed session when network.page is undefined', () => {
      let fallback = { id: 'fallback' };
      expect(pickCookieSession({ page: undefined }, fallback)).toBe(fallback);
    });

    it('falls back to the passed session when network.page lacks a session', () => {
      let fallback = { id: 'fallback' };
      expect(pickCookieSession({ page: {} }, fallback)).toBe(fallback);
    });
  });

  // shouldAttachAuth — re-enforces the same-origin rule for the Node-side
  // direct fetch to avoid leaking Basic auth credentials cross-origin.
  describe('shouldAttachAuth', () => {
    it('returns false when authorization is missing or has no username', () => {
      expect(shouldAttachAuth(undefined, 'http://a.com/x', 'http://a.com')).toBe(false);
      expect(shouldAttachAuth({}, 'http://a.com/x', 'http://a.com')).toBe(false);
      expect(shouldAttachAuth({ username: '' }, 'http://a.com/x', 'http://a.com')).toBe(false);
    });

    it('returns true when authorization is set and origins match', () => {
      expect(shouldAttachAuth({ username: 'u' }, 'http://a.com/x.css', 'http://a.com/page')).toBe(true);
    });

    it('returns false when origins differ (cross-origin auth must not leak)', () => {
      expect(shouldAttachAuth({ username: 'u' }, 'http://a.com/x.css', 'http://b.com/page')).toBe(false);
    });

    it('returns false when either URL is malformed (defensive)', () => {
      expect(shouldAttachAuth({ username: 'u' }, 'not a url', 'http://a.com')).toBe(false);
      expect(shouldAttachAuth({ username: 'u' }, 'http://a.com', undefined)).toBe(false);
    });
  });

  // raceWithTimeout — caps any async work at a wall-clock budget. The
  // direct-fetch fallback uses this to keep a hanging worker host from
  // blocking the snapshot pipeline.
  describe('raceWithTimeout', () => {
    it('resolves with the promise value when it settles before the timeout', async () => {
      let value = await raceWithTimeout(Promise.resolve('ok'), 50, 'timeout');
      expect(value).toBe('ok');
    });

    it('rejects with the timeout message when the promise hangs past the budget', async () => {
      let neverSettles = new Promise(() => {});
      await expectAsync(raceWithTimeout(neverSettles, 10, 'too slow')).toBeRejectedWithError('too slow');
    });

    it('propagates the original rejection when the promise rejects before the timeout', async () => {
      let failing = Promise.reject(new Error('boom'));
      await expectAsync(raceWithTimeout(failing, 50, 'timeout')).toBeRejectedWithError('boom');
    });
  });
});
