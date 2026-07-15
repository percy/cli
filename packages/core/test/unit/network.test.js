import { setupTest, logger } from '../helpers/index.js';
import { Network, AbortCodes, pickCookieSession, shouldAttachAuth, raceWithTimeout, resolveDirectFetchMime, flattenLookupAddresses, MetadataBlockedError } from '../../src/network.js';
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

  // resolveDirectFetchMime — server header > URL ext > binary default.
  describe('resolveDirectFetchMime', () => {
    it('returns the bare server MIME, stripping parameters', () => {
      expect(resolveDirectFetchMime({ 'content-type': 'text/css' }, '/x')).toBe('text/css');
      expect(resolveDirectFetchMime({ 'content-type': 'text/css; charset=utf-8' }, '/x')).toBe('text/css');
    });

    it('falls back to URL-extension mime when no server header', () => {
      expect(resolveDirectFetchMime({}, '/file.css')).toBe('text/css');
      expect(resolveDirectFetchMime(undefined, '/file.png')).toBe('image/png');
    });

    it('falls back to application/octet-stream when neither header nor URL extension is recognized', () => {
      expect(resolveDirectFetchMime({}, '/no-ext')).toBe('application/octet-stream');
      expect(resolveDirectFetchMime({ 'content-type': '' }, '/no-ext')).toBe('application/octet-stream');
    });
  });

  // flattenLookupAddresses — normalizes the dns.lookup callback address argument
  // (Node's http stack passes an array under Happy Eyeballs; others a string) so
  // the direct-fetch choke point can gate on every candidate connection IP.
  describe('flattenLookupAddresses', () => {
    it('flattens the { address, family }[] form used by Node http (all:true)', () => {
      expect(flattenLookupAddresses([
        { address: '127.0.0.1', family: 4 },
        { address: '::1', family: 6 }
      ])).toEqual(['127.0.0.1', '::1']);
    });

    it('wraps a single address string', () => {
      expect(flattenLookupAddresses('169.254.169.254')).toEqual(['169.254.169.254']);
    });

    it('returns an empty list for a missing address', () => {
      expect(flattenLookupAddresses(undefined)).toEqual([]);
      expect(flattenLookupAddresses(null)).toEqual([]);
    });
  });

  // MetadataBlockedError — the typed error the direct-fetch choke point throws so
  // callers can drop the resource without re-logging a generic network error.
  describe('MetadataBlockedError', () => {
    it('carries the offending host and a stable name', () => {
      let err = new MetadataBlockedError('169.254.169.254');
      expect(err).toEqual(jasmine.any(Error));
      expect(err.name).toBe('MetadataBlockedError');
      expect(err.host).toBe('169.254.169.254');
      expect(err.message).toContain('169.254.169.254');
    });
  });

  // Response-stage SSRF gate — the DNS-rebinding leg. Drives _handleResponseReceived
  // directly (no browser) to prove the gate blocks on the IP Chromium actually
  // connected to (response.remoteIPAddress) and never wires up the body buffer, so
  // a rebound metadata response can't be fetched/uploaded even though the
  // request-time literal pre-check let the request through.
  describe('_handleResponseReceived metadata gate', () => {
    async function driveResponse(remoteIPAddress) {
      let net = new Network({ session: {} }, {
        userAgent: 'test',
        meta: { snapshot: { name: 'snap' }, snapshotURL: 'http://localhost:8000/' },
        intercept: { getResource: () => null, disallowedHostnames: [], disableCache: true, currentWidth: 0 }
      });
      net.send = jasmine.createSpy('send').and.resolveTo({});

      let session = {};
      let requestId = 'req-1';
      let url = 'http://localhost:8000/rebind.css';

      // seed the request through the normal request lifecycle
      net._handleRequestWillBeSent({ requestId, request: { url }, type: 'Stylesheet' });
      await net._handleRequest(session, { request: { url }, requestId, interceptId: 'int-1', resourceType: 'Stylesheet' });

      // deliver the CDP response with the (simulated) connected IP
      let response = { remoteIPAddress, status: 200, headers: {} };
      await net._handleResponseReceived(session, { requestId, response });
      return { response };
    }

    it('blocks a response whose connected IP is a metadata endpoint (rebinding) and never buffers the body', async () => {
      let { response } = await driveResponse('169.254.169.254');

      // the body buffer is never attached, so the metadata body cannot be fetched/uploaded
      expect(response.buffer).toBeUndefined();
      expect(logger.stderr).toEqual(jasmine.arrayContaining([
        jasmine.stringMatching(/Refusing to capture resource from cloud metadata endpoint: 169\.254\.169\.254/)
      ]));
    });

    it('blocks an IPv4-mapped IPv6 connected metadata IP', async () => {
      let { response } = await driveResponse('::ffff:169.254.169.254');

      expect(response.buffer).toBeUndefined();
      expect(logger.stderr).toEqual(jasmine.arrayContaining([
        jasmine.stringMatching(/Refusing to capture resource from cloud metadata endpoint: ::ffff:169\.254\.169\.254/)
      ]));
    });

    it('allows a benign connected IP and wires up the body buffer', async () => {
      let { response } = await driveResponse('127.0.0.1');

      // the allowed path attaches the buffer so the body can be captured
      expect(typeof response.buffer).toBe('function');
      expect(logger.stderr).not.toEqual(jasmine.arrayContaining([
        jasmine.stringMatching(/Refusing to capture resource from cloud metadata endpoint/)
      ]));
    });
  });
});
