import { resolveIosRegions, shutdown, XCUI_ALLOWLIST } from '../../src/wda-hierarchy.js';
import { logger, setupTest } from '../helpers/index.js';

// Minimal valid WDA source XML envelope with a handful of XCUIElementType nodes.
// parse() in the resolver reads this into a tree that flattenNodes walks.
const SIMPLE_SOURCE = `<?xml version="1.0" encoding="UTF-8"?>
<AppiumAUT>
  <XCUIElementTypeApplication type="XCUIElementTypeApplication" name="SampleApp" enabled="true" visible="true" x="0" y="0" width="390" height="844">
    <XCUIElementTypeWindow type="XCUIElementTypeWindow" enabled="true" visible="true" x="0" y="0" width="390" height="844">
      <XCUIElementTypeButton type="XCUIElementTypeButton" name="submit-btn" label="Submit" enabled="true" visible="true" x="20" y="100" width="200" height="50"/>
      <XCUIElementTypeButton type="XCUIElementTypeButton" name="cancel-btn" label="Cancel" enabled="true" visible="true" x="20" y="200" width="200" height="50"/>
      <XCUIElementTypeStaticText type="XCUIElementTypeStaticText" name="heading" label="Welcome" enabled="true" visible="true" x="10" y="10" width="370" height="40"/>
    </XCUIElementTypeWindow>
  </XCUIElementTypeApplication>
</AppiumAUT>`;

// Build a fake httpClient response per the `@percy/client/utils#request` contract:
// a function that returns (or throws) like `request(url, options, cb)`.
function makeFakeHttpClient(handlers) {
  // handlers: [{ match: url => bool, respond: () => ({body, statusCode}) | Error }]
  const calls = [];
  async function fake(url, options = {}) {
    calls.push({ url, options });
    for (const { match, respond } of handlers) {
      if (match(url)) {
        const result = typeof respond === 'function' ? respond(url, options) : respond;
        if (result instanceof Error) throw result;
        return result;
      }
    }
    throw Object.assign(new Error(`no handler for ${url}`), { code: 'ECONNREFUSED' });
  }
  fake.calls = calls;
  return fake;
}

const WDA_SCREEN_OK = {
  value: {
    statusBarSize: { width: 390, height: 47 },
    scale: 3,
    screenSize: { width: 390, height: 844 }
  }
};

function stdDeps({ wdaPort = 8408, wdaSessionId, sourceXml = SIMPLE_SOURCE, extraHandlers = [] } = {}) {
  const meta = { ok: true, port: wdaPort };
  if (wdaSessionId) meta.wdaSessionId = wdaSessionId;
  const readWdaMeta = () => meta;
  const httpClient = makeFakeHttpClient([
    { match: url => url.endsWith('/wda/screen'), respond: WDA_SCREEN_OK },
    { match: url => /\/session\/[^/]+\/source$/.test(url), respond: sourceXml },
    ...extraHandlers
  ]);
  return { httpClient, readWdaMeta };
}

const VALID_SID = 'abcdef0123456789abcdef0123456789abcdef01';

describe('Unit / wda-hierarchy', () => {
  beforeEach(async () => {
    await setupTest();
    // Default: kill-switch OFF
    delete process.env.PERCY_DISABLE_IOS_ELEMENT_REGIONS;
  });

  describe('XCUI_ALLOWLIST', () => {
    it('contains common iOS element types', () => {
      expect(XCUI_ALLOWLIST.has('XCUIElementTypeButton')).toBe(true);
      expect(XCUI_ALLOWLIST.has('XCUIElementTypeStaticText')).toBe(true);
      expect(XCUI_ALLOWLIST.has('XCUIElementTypeTextField')).toBe(true);
      expect(XCUI_ALLOWLIST.has('XCUIElementTypeImage')).toBe(true);
    });

    it('rejects unknown short-form', () => {
      expect(XCUI_ALLOWLIST.has('XCUIElementTypeNotARealType')).toBe(false);
    });
  });

  describe('short-circuit gates', () => {
    it('returns empty + landscape-or-ambiguous when isPortrait is false', async () => {
      const deps = stdDeps();
      const res = await resolveIosRegions({
        regions: [{ element: { id: 'submit-btn' } }],
        sessionId: VALID_SID,
        pngWidth: 2532,
        pngHeight: 1170,
        isPortrait: false,
        deps
      });
      // Sparse array — 1 input element region, all null (skipped)
      expect(res.resolvedRegions).toEqual([null]);
      expect(res.warnings).toContain('landscape-or-ambiguous');
      expect(deps.httpClient.calls.length).toBe(0);
    });

    it('returns empty + kill-switch-engaged when PERCY_DISABLE_IOS_ELEMENT_REGIONS=1', async () => {
      process.env.PERCY_DISABLE_IOS_ELEMENT_REGIONS = '1';
      const deps = stdDeps();
      const res = await resolveIosRegions({
        regions: [{ element: { id: 'submit-btn' } }],
        sessionId: VALID_SID,
        pngWidth: 1170,
        pngHeight: 2532,
        isPortrait: true,
        deps
      });
      expect(res.resolvedRegions).toEqual([null]);
      expect(res.warnings).toContain('kill-switch-engaged');
      expect(deps.httpClient.calls.length).toBe(0);
    });

    it('returns empty + propagated wda-meta reason when readWdaMeta fails', async () => {
      const httpClient = makeFakeHttpClient([]);
      const readWdaMeta = () => ({ ok: false, reason: 'missing' });
      const res = await resolveIosRegions({
        regions: [{ element: { id: 'submit-btn' } }],
        sessionId: VALID_SID,
        pngWidth: 1170,
        pngHeight: 2532,
        isPortrait: true,
        deps: { httpClient, readWdaMeta }
      });
      expect(res.resolvedRegions).toEqual([null]);
      expect(res.warnings).toContain('missing');
      expect(httpClient.calls.length).toBe(0);
    });

    it('skips resolver entirely when regions array contains no element regions', async () => {
      const deps = stdDeps();
      const res = await resolveIosRegions({
        regions: [{ top: 0, left: 0, right: 100, bottom: 100 }], // coord-only
        sessionId: VALID_SID,
        pngWidth: 1170,
        pngHeight: 2532,
        isPortrait: true,
        deps
      });
      // 0 element regions in input → sparse array of length 0
      expect(res.resolvedRegions).toEqual([]);
      expect(deps.httpClient.calls.length).toBe(0);
    });
  });

  describe('wda-session-id routing (contract v1.1.0)', () => {
    const WDA_SID = '079FB256-3ADD-43A3-A5FB-F9B85269F84C';
    const FRESH_WDA_SID = '0FD8A4F7-6AF2-49D8-96FA-28832EADD879';
    const STALE_SESSION_ERR = { value: { error: 'invalid session id', message: 'Session does not exist' } };

    it('uses meta.wdaSessionId — not the SDK sessionId — for /source', async () => {
      const deps = stdDeps({ wdaSessionId: WDA_SID });
      await resolveIosRegions({
        regions: [{ element: { id: 'submit-btn' } }],
        sessionId: VALID_SID,
        pngWidth: 1170,
        pngHeight: 2532,
        isPortrait: true,
        deps
      });
      const sourceCall = deps.httpClient.calls.find(c => /\/source$/.test(c.url));
      expect(sourceCall).toBeDefined();
      expect(sourceCall.url).toContain(`/session/${WDA_SID}/source`);
      expect(sourceCall.url).not.toContain(VALID_SID);
    });

    it('falls back to SDK sessionId when meta.wdaSessionId is absent (v1.0.0)', async () => {
      const deps = stdDeps(); // no wdaSessionId
      await resolveIosRegions({
        regions: [{ element: { id: 'submit-btn' } }],
        sessionId: VALID_SID,
        pngWidth: 1170,
        pngHeight: 2532,
        isPortrait: true,
        deps
      });
      const sourceCall = deps.httpClient.calls.find(c => /\/source$/.test(c.url));
      expect(sourceCall).toBeDefined();
      expect(sourceCall.url).toContain(`/session/${VALID_SID}/source`);
    });

    it('on stale sid, retries /source with the active sid carried in the error body', async () => {
      // Current WDA builds embed the active sessionId at the top-level of every
      // response, including error envelopes. This is the preferred recovery path
      // — no extra /status call needed.
      const staleWithActiveSid = { ...STALE_SESSION_ERR, sessionId: FRESH_WDA_SID };
      const httpClient = makeFakeHttpClient([
        { match: url => url.endsWith('/wda/screen'), respond: WDA_SCREEN_OK },
        // First /source hit (with stale sid) returns the envelope that carries the active sid.
        {
          match: url => url.includes(`/session/${WDA_SID}/source`),
          respond: staleWithActiveSid
        },
        // Retry hit (with fresh sid) returns a valid XML body.
        {
          match: url => url.includes(`/session/${FRESH_WDA_SID}/source`),
          respond: SIMPLE_SOURCE
        }
      ]);
      const readWdaMeta = () => ({ ok: true, port: 8408, wdaSessionId: WDA_SID });

      const res = await resolveIosRegions({
        regions: [{ element: { id: 'submit-btn' } }],
        sessionId: VALID_SID,
        pngWidth: 1170,
        pngHeight: 2532,
        isPortrait: true,
        deps: { httpClient, readWdaMeta }
      });

      const sourceCalls = httpClient.calls.filter(c => /\/source$/.test(c.url));
      const statusCalls = httpClient.calls.filter(c => c.url.endsWith('/status'));
      expect(sourceCalls.length).toBe(2);
      expect(sourceCalls[0].url).toContain(WDA_SID);
      expect(sourceCalls[1].url).toContain(FRESH_WDA_SID);
      // /status is NOT called when the error body already carries the active sid.
      expect(statusCalls.length).toBe(0);

      // Retry succeeds → region resolves.
      expect(res.resolvedRegions.filter(Boolean).length).toBe(1);
      expect(res.warnings).not.toContain('wda-error');
    });

    it('extracts active sid from err.response.body when the HTTP client rejects non-2xx', async () => {
      // @percy/client/utils#request throws on non-2xx, attaching the parsed body
      // to err.response.body. The retry path must still find the active sid.
      const staleWithActiveSid = { ...STALE_SESSION_ERR, sessionId: FRESH_WDA_SID };
      const httpErr = Object.assign(new Error('404 Not Found'), {
        response: { statusCode: 404, headers: {}, body: staleWithActiveSid }
      });

      const httpClient = makeFakeHttpClient([
        { match: url => url.endsWith('/wda/screen'), respond: WDA_SCREEN_OK },
        {
          match: url => url.includes(`/session/${WDA_SID}/source`),
          respond: httpErr
        },
        {
          match: url => url.includes(`/session/${FRESH_WDA_SID}/source`),
          respond: SIMPLE_SOURCE
        }
      ]);
      const readWdaMeta = () => ({ ok: true, port: 8408, wdaSessionId: WDA_SID });

      const res = await resolveIosRegions({
        regions: [{ element: { id: 'submit-btn' } }],
        sessionId: VALID_SID,
        pngWidth: 1170,
        pngHeight: 2532,
        isPortrait: true,
        deps: { httpClient, readWdaMeta }
      });

      const sourceCalls = httpClient.calls.filter(c => /\/source$/.test(c.url));
      expect(sourceCalls.length).toBe(2);
      expect(sourceCalls[1].url).toContain(FRESH_WDA_SID);
      expect(res.resolvedRegions.filter(Boolean).length).toBe(1);
    });

    it('falls back to /status when the stale-session error has no top-level sid', async () => {
      const staleNoSid = STALE_SESSION_ERR; // no top-level sessionId
      const httpClient = makeFakeHttpClient([
        { match: url => url.endsWith('/wda/screen'), respond: WDA_SCREEN_OK },
        { match: url => url.endsWith('/status'), respond: { value: { ready: true }, sessionId: FRESH_WDA_SID } },
        {
          match: url => url.includes(`/session/${WDA_SID}/source`),
          respond: staleNoSid
        },
        {
          match: url => url.includes(`/session/${FRESH_WDA_SID}/source`),
          respond: SIMPLE_SOURCE
        }
      ]);
      const readWdaMeta = () => ({ ok: true, port: 8408, wdaSessionId: WDA_SID });

      const res = await resolveIosRegions({
        regions: [{ element: { id: 'submit-btn' } }],
        sessionId: VALID_SID,
        pngWidth: 1170,
        pngHeight: 2532,
        isPortrait: true,
        deps: { httpClient, readWdaMeta }
      });

      const sourceCalls = httpClient.calls.filter(c => /\/source$/.test(c.url));
      const statusCalls = httpClient.calls.filter(c => c.url.endsWith('/status'));
      expect(sourceCalls.length).toBe(2);
      expect(statusCalls.length).toBe(1);
      expect(res.resolvedRegions.filter(Boolean).length).toBe(1);
    });

    it('returns wda-error when /status probe also fails', async () => {
      const httpClient = makeFakeHttpClient([
        { match: url => url.endsWith('/wda/screen'), respond: WDA_SCREEN_OK },
        // /status returns junk without sessionId.
        { match: url => url.endsWith('/status'), respond: { value: { ready: false } } },
        { match: url => /\/source$/.test(url), respond: STALE_SESSION_ERR }
      ]);
      const readWdaMeta = () => ({ ok: true, port: 8408, wdaSessionId: WDA_SID });

      const res = await resolveIosRegions({
        regions: [{ element: { id: 'submit-btn' } }],
        sessionId: VALID_SID,
        pngWidth: 1170,
        pngHeight: 2532,
        isPortrait: true,
        deps: { httpClient, readWdaMeta }
      });

      // Only one /source call (no retry) because /status couldn't supply a fresh sid.
      const sourceCalls = httpClient.calls.filter(c => /\/source$/.test(c.url));
      expect(sourceCalls.length).toBe(1);
      expect(res.warnings).toContain('wda-error');
      expect(res.resolvedRegions[0]).toBeNull();
    });

    it('returns wda-error without retry when /status returns the same stale sid', async () => {
      const httpClient = makeFakeHttpClient([
        { match: url => url.endsWith('/wda/screen'), respond: WDA_SCREEN_OK },
        // /status returns the same sid Percy CLI just rejected.
        { match: url => url.endsWith('/status'), respond: { sessionId: WDA_SID } },
        { match: url => /\/source$/.test(url), respond: STALE_SESSION_ERR }
      ]);
      const readWdaMeta = () => ({ ok: true, port: 8408, wdaSessionId: WDA_SID });

      const res = await resolveIosRegions({
        regions: [{ element: { id: 'submit-btn' } }],
        sessionId: VALID_SID,
        pngWidth: 1170,
        pngHeight: 2532,
        isPortrait: true,
        deps: { httpClient, readWdaMeta }
      });

      // No retry (same sid would hit the same error).
      const sourceCalls = httpClient.calls.filter(c => /\/source$/.test(c.url));
      expect(sourceCalls.length).toBe(1);
      expect(res.warnings).toContain('wda-error');
    });
  });

  describe('happy path selector resolution', () => {
    it('resolves id selector to pixel bbox (scaled × 3)', async () => {
      const deps = stdDeps();
      const res = await resolveIosRegions({
        regions: [{ element: { id: 'submit-btn' }, algorithm: 'ignore' }],
        sessionId: VALID_SID,
        pngWidth: 1170,
        pngHeight: 2532,
        isPortrait: true,
        deps
      });
      expect(res.resolvedRegions.filter(Boolean).length).toBe(1);
      // submit-btn is at (20, 100, 200, 50) in points; scale 3 → (60, 300, 660, 450) in pixels
      expect(res.resolvedRegions[0]).toEqual(jasmine.objectContaining({
        boundingBox: jasmine.objectContaining({ left: 60, top: 300, right: 660, bottom: 450 }),
        algorithm: 'ignore'
      }));
    });

    it('resolves class selector (short-form Button) to first XCUIElementTypeButton', async () => {
      const deps = stdDeps();
      const res = await resolveIosRegions({
        regions: [{ element: { class: 'Button' } }],
        sessionId: VALID_SID,
        pngWidth: 1170,
        pngHeight: 2532,
        isPortrait: true,
        deps
      });
      expect(res.resolvedRegions.filter(Boolean).length).toBe(1);
      expect(res.resolvedRegions[0].boundingBox).toEqual({ left: 60, top: 300, right: 660, bottom: 450 });
    });

    it('resolves class selector long-form XCUIElementTypeStaticText identically to short-form StaticText', async () => {
      const deps1 = stdDeps();
      const deps2 = stdDeps();
      const long = await resolveIosRegions({
        regions: [{ element: { class: 'XCUIElementTypeStaticText' } }],
        sessionId: VALID_SID,
        pngWidth: 1170,
        pngHeight: 2532,
        isPortrait: true,
        deps: deps1
      });
      const short = await resolveIosRegions({
        regions: [{ element: { class: 'StaticText' } }],
        sessionId: VALID_SID,
        pngWidth: 1170,
        pngHeight: 2532,
        isPortrait: true,
        deps: deps2
      });
      expect(long.resolvedRegions).toEqual(short.resolvedRegions);
    });

    it('multi-match returns first in tree order', async () => {
      const deps = stdDeps();
      const res = await resolveIosRegions({
        regions: [{ element: { class: 'Button' } }],
        sessionId: VALID_SID,
        pngWidth: 1170,
        pngHeight: 2532,
        isPortrait: true,
        deps
      });
      // submit-btn is first Button in tree order; bbox = (60,300,660,450)
      expect(res.resolvedRegions[0].boundingBox).toEqual({ left: 60, top: 300, right: 660, bottom: 450 });
    });

    it('resolves multiple regions in one call (single /source fetch)', async () => {
      const deps = stdDeps();
      const res = await resolveIosRegions({
        regions: [
          { element: { id: 'submit-btn' } },
          { element: { id: 'heading' } }
        ],
        sessionId: VALID_SID,
        pngWidth: 1170,
        pngHeight: 2532,
        isPortrait: true,
        deps
      });
      expect(res.resolvedRegions.filter(Boolean).length).toBe(2);
      // /source should be fetched once, not twice (per-screenshot cache)
      const sourceCalls = deps.httpClient.calls.filter(c => c.url.endsWith('/source'));
      expect(sourceCalls.length).toBe(1);
    });
  });

  describe('selector validation', () => {
    it('class not in allowlist → warn-skip class-not-allowlisted (no WDA call beyond /screen)', async () => {
      const deps = stdDeps();
      const res = await resolveIosRegions({
        regions: [{ element: { class: 'NotARealClass' } }],
        sessionId: VALID_SID,
        pngWidth: 1170,
        pngHeight: 2532,
        isPortrait: true,
        deps
      });
      expect(res.resolvedRegions.filter(Boolean).length).toBe(0);
      expect(res.warnings).toContain('class-not-allowlisted');
    });

    it('selector value > 256 chars → warn-skip selector-too-long', async () => {
      const deps = stdDeps();
      const longVal = 'x'.repeat(257);
      const res = await resolveIosRegions({
        regions: [{ element: { id: longVal } }],
        sessionId: VALID_SID,
        pngWidth: 1170,
        pngHeight: 2532,
        isPortrait: true,
        deps
      });
      expect(res.resolvedRegions.filter(Boolean).length).toBe(0);
      expect(res.warnings).toContain('selector-too-long');
    });

    it('text selector → warn-skip selector-key-not-in-v1 (only id + class in V1)', async () => {
      const deps = stdDeps();
      const res = await resolveIosRegions({
        regions: [{ element: { text: 'Submit' } }],
        sessionId: VALID_SID,
        pngWidth: 1170,
        pngHeight: 2532,
        isPortrait: true,
        deps
      });
      expect(res.resolvedRegions.filter(Boolean).length).toBe(0);
      expect(res.warnings).toContain('selector-key-not-in-v1');
    });

    it('xpath selector → warn-skip selector-key-not-in-v1', async () => {
      const deps = stdDeps();
      const res = await resolveIosRegions({
        regions: [{ element: { xpath: '//button' } }],
        sessionId: VALID_SID,
        pngWidth: 1170,
        pngHeight: 2532,
        isPortrait: true,
        deps
      });
      expect(res.warnings).toContain('selector-key-not-in-v1');
    });

    it('zero-match → warn-skip zero-match (no value in logs)', async () => {
      const deps = stdDeps();
      const res = await resolveIosRegions({
        regions: [{ element: { id: 'does-not-exist-here-xyz' } }],
        sessionId: VALID_SID,
        pngWidth: 1170,
        pngHeight: 2532,
        isPortrait: true,
        deps
      });
      expect(res.resolvedRegions.filter(Boolean).length).toBe(0);
      expect(res.warnings).toContain('zero-match');
      const joined = [...(logger.stderr || []), ...(logger.stdout || [])].join('\n');
      expect(joined).not.toContain('does-not-exist-here-xyz');
    });
  });

  describe('security hardening', () => {
    it('GET /source > 20 MB → warn-skip source-oversize (response never parsed)', async () => {
      // Fake a 21 MB response — we emulate via httpClient returning oversize string.
      const oversizeXml = '<?xml version="1.0"?>\n' + 'X'.repeat(21 * 1024 * 1024);
      const deps = stdDeps({ sourceXml: oversizeXml });
      const res = await resolveIosRegions({
        regions: [{ element: { id: 'submit-btn' } }],
        sessionId: VALID_SID,
        pngWidth: 1170,
        pngHeight: 2532,
        isPortrait: true,
        deps
      });
      expect(res.warnings).toContain('source-oversize');
      expect(res.resolvedRegions).toEqual([null]);
    });

    it('source with <!DOCTYPE … [ENTITY … ]> → warn-skip xml-rejected (pre-parse guard)', async () => {
      const xxeXml = `<?xml version="1.0"?>
<!DOCTYPE foo [ <!ENTITY bar "evil"> ]>
<AppiumAUT><XCUIElementTypeButton name="submit-btn" x="0" y="0" width="10" height="10"/></AppiumAUT>`;
      const deps = stdDeps({ sourceXml: xxeXml });
      const res = await resolveIosRegions({
        regions: [{ element: { id: 'submit-btn' } }],
        sessionId: VALID_SID,
        pngWidth: 1170,
        pngHeight: 2532,
        isPortrait: true,
        deps
      });
      expect(res.warnings).toContain('xml-rejected');
      expect(res.resolvedRegions).toEqual([null]);
    });

    it('WDA HTTP error on /source → warn-skip wda-error', async () => {
      const readWdaMeta = () => ({ ok: true, port: 8408 });
      const httpClient = makeFakeHttpClient([
        { match: url => url.endsWith('/wda/screen'), respond: WDA_SCREEN_OK },
        {
          match: url => url.endsWith('/source'),
          respond: () => { throw Object.assign(new Error('HTTP 500'), { response: { statusCode: 500 } }); }
        }
      ]);
      const res = await resolveIosRegions({
        regions: [{ element: { id: 'submit-btn' } }],
        sessionId: VALID_SID,
        pngWidth: 1170,
        pngHeight: 2532,
        isPortrait: true,
        deps: { httpClient, readWdaMeta }
      });
      expect(res.warnings).toContain('wda-error');
      expect(res.resolvedRegions).toEqual([null]);
    });
  });

  describe('bbox validation', () => {
    it('bbox out of screenshot bounds → warn-skip bbox-out-of-bounds', async () => {
      // Fabricate a source where element extends beyond pngWidth.
      const outXml = `<?xml version="1.0"?>
<AppiumAUT><XCUIElementTypeButton name="submit-btn" x="0" y="0" width="500" height="50"/></AppiumAUT>`;
      // 500 × scale 3 = 1500 pixels; pngWidth is 1170 → right (1500) > pngWidth (1170) → out-of-bounds
      const deps = stdDeps({ sourceXml: outXml });
      const res = await resolveIosRegions({
        regions: [{ element: { id: 'submit-btn' } }],
        sessionId: VALID_SID,
        pngWidth: 1170,
        pngHeight: 2532,
        isPortrait: true,
        deps
      });
      expect(res.warnings).toContain('bbox-out-of-bounds');
      expect(res.resolvedRegions).toEqual([null]);
    });

    it('bbox zero-area (< 4×4 px) → warn-skip bbox-too-small', async () => {
      const smallXml = `<?xml version="1.0"?>
<AppiumAUT><XCUIElementTypeButton name="submit-btn" x="0" y="0" width="1" height="1"/></AppiumAUT>`;
      // 1 × scale 3 = 3 pixels → less than the 4-px minimum
      const deps = stdDeps({ sourceXml: smallXml });
      const res = await resolveIosRegions({
        regions: [{ element: { id: 'submit-btn' } }],
        sessionId: VALID_SID,
        pngWidth: 1170,
        pngHeight: 2532,
        isPortrait: true,
        deps
      });
      expect(res.warnings).toContain('bbox-too-small');
      expect(res.resolvedRegions).toEqual([null]);
    });
  });

  describe('log scrubbing (R7 forbidden fields)', () => {
    it('does not emit selector value, port, sessionId, or coords in logs', async () => {
      const deps = stdDeps();
      await resolveIosRegions({
        regions: [{ element: { id: 'submit-btn' } }],
        sessionId: VALID_SID,
        pngWidth: 1170,
        pngHeight: 2532,
        isPortrait: true,
        deps
      });
      const joined = [...(logger.stderr || []), ...(logger.stdout || [])].join('\n');
      expect(joined).not.toContain('submit-btn'); // selector value
      expect(joined).not.toContain('8408'); // WDA port
      expect(joined).not.toContain(VALID_SID); // raw sessionId
      expect(joined).not.toContain('60,300,660,450'); // coords string
    });
  });

  describe('shutdown', () => {
    it('exports a shutdown function that aborts in-flight controllers', () => {
      expect(typeof shutdown).toBe('function');
      expect(() => shutdown()).not.toThrow();
    });
  });
});
