import { setupTest } from '@percy/cli-command/test/helpers';
import { checkConnectivity, REQUIRED_DOMAINS } from '@percy/cli-doctor/src/checks/connectivity.js';

// ─── Shared probe results ──────────────────────────────────────────────────────

const OK        = { ok: true,  status: 200, error: null, errorCode: null, latencyMs: 10 };
const OK_403    = { ok: false, status: 403, error: null, errorCode: null, latencyMs: 12 };
const OK_401    = { ok: false, status: 401, error: null, errorCode: null, latencyMs: 11 };
const ENOTFOUND = { ok: false, status: 0,   error: 'ENOTFOUND',  errorCode: 'ENOTFOUND',  latencyMs: 5 };
const ETIMEDOUT = { ok: false, status: 0,   error: 'ETIMEDOUT',  errorCode: 'ETIMEDOUT',  latencyMs: 0 };
const EREFUSED  = { ok: false, status: 0,   error: 'ECONNREFUSED', errorCode: 'ECONNREFUSED', latencyMs: 3 };
const SSL_ERR   = { ok: false, status: 0,   error: 'cert expired', errorCode: 'CERT_HAS_EXPIRED', latencyMs: 6 };

// ─── REQUIRED_DOMAINS ─────────────────────────────────────────────────────────

describe('REQUIRED_DOMAINS', () => {
  it('contains percy.io', () => {
    expect(REQUIRED_DOMAINS.some(d => d.url === 'https://percy.io')).toBeTrue();
  });

  it('contains browserstack.com', () => {
    expect(REQUIRED_DOMAINS.some(d => d.url.includes('browserstack.com'))).toBeTrue();
  });

  it('contains hub.browserstack.com', () => {
    expect(REQUIRED_DOMAINS.some(d => d.url === 'https://hub.browserstack.com')).toBeTrue();
  });

  it('contains storage.googleapis.com marked as optional', () => {
    const gcs = REQUIRED_DOMAINS.find(d => d.url === 'https://storage.googleapis.com');
    expect(gcs).toBeDefined();
    expect(gcs.optional).toBeTrue();
  });

  it('storage.googleapis.com onFail includes PERCY_CHROMIUM_BASE_URL hint', () => {
    const gcs = REQUIRED_DOMAINS.find(d => d.url === 'https://storage.googleapis.com');
    const hasHint = gcs.onFail.some(s => s.includes('PERCY_CHROMIUM_BASE_URL'));
    expect(hasHint).toBeTrue();
  });
});

// ─── checkConnectivity ────────────────────────────────────────────────────────

describe('checkConnectivity', () => {
  beforeEach(async () => {
    await setupTest();
  });

  // ── All pass ──────────────────────────────────────────────────────────────

  it('returns pass for every domain when all return 200', async () => {
    spyOn(await import('@percy/cli-doctor/src/utils/http.js'), 'probeUrl')
      .and.resolveTo(OK);
    const findings = await checkConnectivity();
    expect(findings.every(f => f.status === 'pass')).toBeTrue();
  });

  it('returns pass for 4xx responses (network-reachable)', async () => {
    spyOn(await import('@percy/cli-doctor/src/utils/http.js'), 'probeUrl')
      .and.resolveTo(OK_401);
    const findings = await checkConnectivity();
    expect(findings.every(f => f.status === 'pass')).toBeTrue();
  });

  it('403 is treated as reachable', async () => {
    spyOn(await import('@percy/cli-doctor/src/utils/http.js'), 'probeUrl')
      .and.resolveTo(OK_403);
    const findings = await checkConnectivity();
    expect(findings.every(f => f.status === 'pass')).toBeTrue();
  });

  it('pass message includes HTTP status and latency', async () => {
    spyOn(await import('@percy/cli-doctor/src/utils/http.js'), 'probeUrl')
      .and.resolveTo({ ...OK, status: 200, latencyMs: 55 });
    const findings = await checkConnectivity();
    const passes = findings.filter(f => f.status === 'pass');
    expect(passes.length).toBeGreaterThan(0);
    expect(passes[0].message).toContain('200');
    expect(passes[0].message).toContain('55ms');
  });

  // ── DNS failure ───────────────────────────────────────────────────────────

  it('returns fail on ENOTFOUND', async () => {
    spyOn(await import('@percy/cli-doctor/src/utils/http.js'), 'probeUrl')
      .and.resolveTo(ENOTFOUND);
    const findings = await checkConnectivity();
    expect(findings.some(f => f.status === 'fail')).toBeTrue();
  });

  it('fail message mentions the domain label', async () => {
    spyOn(await import('@percy/cli-doctor/src/utils/http.js'), 'probeUrl')
      .and.resolveTo(ENOTFOUND);
    const findings = await checkConnectivity();
    const fail = findings.find(f => f.status === 'fail');
    expect(fail.label).toBeDefined();
    expect(fail.message).toContain(fail.label);
  });

  it('ENOTFOUND suggestions mention DNS', async () => {
    spyOn(await import('@percy/cli-doctor/src/utils/http.js'), 'probeUrl')
      .and.resolveTo(ENOTFOUND);
    const findings = await checkConnectivity();
    const fail = findings.find(f => f.status === 'fail');
    const hasDns = fail.suggestions.some(s => /dns/i.test(s));
    expect(hasDns).toBeTrue();
  });

  // ── Timeout failure ───────────────────────────────────────────────────────

  it('returns fail on ETIMEDOUT', async () => {
    spyOn(await import('@percy/cli-doctor/src/utils/http.js'), 'probeUrl')
      .and.resolveTo(ETIMEDOUT);
    const findings = await checkConnectivity();
    expect(findings.some(f => f.status === 'fail')).toBeTrue();
  });

  it('ETIMEDOUT suggestions mention firewall or proxy', async () => {
    spyOn(await import('@percy/cli-doctor/src/utils/http.js'), 'probeUrl')
      .and.resolveTo(ETIMEDOUT);
    const findings = await checkConnectivity();
    const fail = findings.find(f => f.status === 'fail');
    const hasFwOrProxy = fail.suggestions.some(s => /firewall|proxy/i.test(s));
    expect(hasFwOrProxy).toBeTrue();
  });

  // ── Connection refused ────────────────────────────────────────────────────

  it('returns fail on ECONNREFUSED', async () => {
    spyOn(await import('@percy/cli-doctor/src/utils/http.js'), 'probeUrl')
      .and.resolveTo(EREFUSED);
    const findings = await checkConnectivity();
    expect(findings.some(f => f.status === 'fail')).toBeTrue();
  });

  // ── Proxy-only reachable ──────────────────────────────────────────────────

  it('returns warn when domain is only reachable via proxy', async () => {
    const proxyUrl = 'http://proxy.test:3128';
    spyOn(await import('@percy/cli-doctor/src/utils/http.js'), 'probeUrl')
      .and.callFake((url, opts = {}) =>
        Promise.resolve(opts.proxyUrl ? OK : ENOTFOUND));

    const findings = await checkConnectivity({ proxyUrl });
    const warn = findings.find(f => f.status === 'warn' && f.message?.includes('proxy'));
    expect(warn).toBeDefined();
  });

  it('warn suggestions mention HTTPS_PROXY', async () => {
    const proxyUrl = 'http://proxy.test:3128';
    spyOn(await import('@percy/cli-doctor/src/utils/http.js'), 'probeUrl')
      .and.callFake((url, opts = {}) =>
        Promise.resolve(opts.proxyUrl ? OK : ENOTFOUND));

    const findings = await checkConnectivity({ proxyUrl });
    const warn = findings.find(f => f.status === 'warn' && f.message?.includes('proxy'));
    const hasProxy = warn.suggestions.some(s => /HTTPS_PROXY/i.test(s));
    expect(hasProxy).toBeTrue();
  });

  // ── SSL errors ────────────────────────────────────────────────────────────

  it('returns fail with SSL error message for SSL error result', async () => {
    // CERT_HAS_EXPIRED is in SSL_ERROR_CODES — real isSslError() returns true
    spyOn(await import('@percy/cli-doctor/src/utils/http.js'), 'probeUrl')
      .and.resolveTo(SSL_ERR);
    const findings = await checkConnectivity();
    expect(findings.some(f => f.status === 'fail')).toBeTrue();
    const fail = findings.find(f => f.status === 'fail');
    expect(fail.message).toMatch(/ssl error/i);
  });

  // ── Optional domain (storage.googleapis.com) ──────────────────────────────

  it('storage.googleapis.com failure is demoted to warn', async () => {
    spyOn(await import('@percy/cli-doctor/src/utils/http.js'), 'probeUrl')
      .and.callFake((url) =>
        Promise.resolve(url.includes('storage.googleapis.com') ? ENOTFOUND : OK));

    const findings = await checkConnectivity();
    const gcs = findings.find(f => f.url === 'https://storage.googleapis.com');
    expect(gcs).toBeDefined();
    expect(gcs.status).toBe('warn');
  });

  it('storage.googleapis.com warn includes PERCY_CHROMIUM_BASE_URL hint', async () => {
    spyOn(await import('@percy/cli-doctor/src/utils/http.js'), 'probeUrl')
      .and.callFake((url) =>
        Promise.resolve(url.includes('storage.googleapis.com') ? ENOTFOUND : OK));

    const findings = await checkConnectivity();
    const gcs = findings.find(f => f.url === 'https://storage.googleapis.com');
    const hasHint = gcs.suggestions.some(s => s.includes('PERCY_CHROMIUM_BASE_URL'));
    expect(hasHint).toBeTrue();
  });

  it('storage.googleapis.com pass remains pass', async () => {
    spyOn(await import('@percy/cli-doctor/src/utils/http.js'), 'probeUrl')
      .and.resolveTo(OK);
    const findings = await checkConnectivity();
    const gcs = findings.find(f => f.url === 'https://storage.googleapis.com');
    expect(gcs.status).toBe('pass');
  });

  // ── Extra URLs ────────────────────────────────────────────────────────────

  it('includes extraUrls in probed targets', async () => {
    const probeSpy = spyOn(
      await import('@percy/cli-doctor/src/utils/http.js'), 'probeUrl'
    ).and.resolveTo(OK);

    await checkConnectivity({ extraUrls: ['https://custom.example.com'] });

    const urls = probeSpy.calls.allArgs().map(args => args[0]);
    expect(urls).toContain('https://custom.example.com');
  });

  it('extra URL finding has the URL as its label', async () => {
    spyOn(await import('@percy/cli-doctor/src/utils/http.js'), 'probeUrl')
      .and.resolveTo(OK);
    const findings = await checkConnectivity({ extraUrls: ['https://custom.example.com'] });
    const extra = findings.find(f => f.url === 'https://custom.example.com');
    expect(extra).toBeDefined();
    expect(extra.label).toBe('https://custom.example.com');
  });

  // ── Return shape ──────────────────────────────────────────────────────────

  it('returns an array', async () => {
    spyOn(await import('@percy/cli-doctor/src/utils/http.js'), 'probeUrl')
      .and.resolveTo(OK);
    const findings = await checkConnectivity();
    expect(Array.isArray(findings)).toBeTrue();
  });

  it('each finding has status, label, url, message', async () => {
    spyOn(await import('@percy/cli-doctor/src/utils/http.js'), 'probeUrl')
      .and.resolveTo(OK);
    const findings = await checkConnectivity();
    for (const f of findings) {
      expect(f.status).toBeDefined();
      expect(f.label).toBeDefined();
      expect(f.url).toBeDefined();
      expect(f.message).toBeDefined();
    }
  });

  it('failures sort before passes', async () => {
    spyOn(await import('@percy/cli-doctor/src/utils/http.js'), 'probeUrl')
      .and.callFake((url) =>
        Promise.resolve(url.includes('percy.io') ? ENOTFOUND : OK));

    const findings = await checkConnectivity();
    const firstFail = findings.findIndex(f => f.status === 'fail');
    const firstPass = findings.findIndex(f => f.status === 'pass');
    if (firstFail !== -1 && firstPass !== -1) {
      expect(firstFail).toBeLessThan(firstPass);
    }
  });
});
