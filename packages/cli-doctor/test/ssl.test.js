import { setupTest } from '@percy/cli-command/test/helpers';
import { checkSSL } from '@percy/cli-doctor/src/checks/ssl.js';

// ─── Shared mock helper ───────────────────────────────────────────────────────

async function mockProbe(result) {
  spyOn(await import('@percy/cli-doctor/src/utils/http.js'), 'probeUrl')
    .and.resolveTo(result);
}

const OK = { ok: true, status: 200, error: null, errorCode: null, latencyMs: 10 };
const ENOTFOUND = { ok: false, status: 0, error: 'ENOTFOUND', errorCode: 'ENOTFOUND', latencyMs: 5 };
const CERT_EXPIRED = { ok: false, status: 0, error: 'certificate has expired', errorCode: 'CERT_HAS_EXPIRED', latencyMs: 8 };
const SELF_SIGNED = { ok: false, status: 0, error: 'self signed certificate', errorCode: 'DEPTH_ZERO_SELF_SIGNED_CERT', latencyMs: 6 };

// ─── checkSSL ─────────────────────────────────────────────────────────────────

describe('checkSSL', () => {
  beforeEach(async () => {
    await setupTest();
  });

  afterEach(() => {
    delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  });

  // ── Happy path ──────────────────────────────────────────────────────────────

  it('returns a pass finding when SSL handshake succeeds', async () => {
    await mockProbe(OK);
    const findings = await checkSSL();
    expect(findings.some(f => f.status === 'pass')).toBeTrue();
  });

  it('pass message includes latency', async () => {
    await mockProbe({ ...OK, latencyMs: 42 });
    const findings = await checkSSL();
    const pass = findings.find(f => f.status === 'pass');
    expect(pass.message).toContain('42ms');
  });

  // ── NODE_TLS_REJECT_UNAUTHORIZED ────────────────────────────────────────────

  it('returns a warn when NODE_TLS_REJECT_UNAUTHORIZED=0 is set', async () => {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
    await mockProbe(OK);
    const findings = await checkSSL();
    const warn = findings.find(f => f.status === 'warn');
    expect(warn).toBeDefined();
    expect(warn.message).toMatch(/NODE_TLS_REJECT_UNAUTHORIZED/);
  });

  it('does not warn when NODE_TLS_REJECT_UNAUTHORIZED is not set', async () => {
    await mockProbe(OK);
    const findings = await checkSSL();
    expect(findings.every(f => f.status !== 'warn')).toBeTrue();
  });

  // ── SSL errors ──────────────────────────────────────────────────────────────

  it('returns a fail for CERT_HAS_EXPIRED', async () => {
    await mockProbe(CERT_EXPIRED);
    const findings = await checkSSL();
    const fail = findings.find(f => f.status === 'fail');
    expect(fail).toBeDefined();
    expect(fail.message).toMatch(/ssl error/i);
    expect(fail.message).toContain('CERT_HAS_EXPIRED');
  });

  it('fail finding includes configFix', async () => {
    await mockProbe(CERT_EXPIRED);
    const findings = await checkSSL();
    const fail = findings.find(f => f.status === 'fail');
    expect(fail.configFix).toBeDefined();
    expect(fail.configFix.key).toBe('ssl.rejectUnauthorized');
    expect(fail.configFix.value).toBe(false);
  });

  it('fail finding includes NODE_TLS_REJECT_UNAUTHORIZED suggestion', async () => {
    await mockProbe(CERT_EXPIRED);
    const findings = await checkSSL();
    const fail = findings.find(f => f.status === 'fail');
    const hasTLSSuggestion = fail.suggestions.some(s =>
      s.includes('NODE_TLS_REJECT_UNAUTHORIZED')
    );
    expect(hasTLSSuggestion).toBeTrue();
  });

  it('returns a fail for DEPTH_ZERO_SELF_SIGNED_CERT', async () => {
    await mockProbe(SELF_SIGNED);
    const findings = await checkSSL();
    expect(findings.some(f => f.status === 'fail')).toBeTrue();
  });

  // ── Non-SSL network error ───────────────────────────────────────────────────

  it('skips SSL check for ENOTFOUND (not an SSL error)', async () => {
    await mockProbe(ENOTFOUND);
    const findings = await checkSSL();
    expect(findings.every(f => f.status !== 'fail')).toBeTrue();
    expect(findings.some(f => f.status === 'skip')).toBeTrue();
  });

  it('skip finding message mentions connectivity check', async () => {
    await mockProbe(ENOTFOUND);
    const findings = await checkSSL();
    const skip = findings.find(f => f.status === 'skip');
    expect(skip.message).toMatch(/connectivity/i);
  });

  // ── With proxy ──────────────────────────────────────────────────────────────

  it('passes proxyUrl option through to probeUrl', async () => {
    const probeSpy = spyOn(
      await import('@percy/cli-doctor/src/utils/http.js'),
      'probeUrl'
    ).and.resolveTo(OK);

    await checkSSL({ proxyUrl: 'http://proxy.test:3128', timeout: 5000 });
    expect(probeSpy).toHaveBeenCalledWith(
      jasmine.any(String),
      jasmine.objectContaining({ proxyUrl: 'http://proxy.test:3128', timeout: 5000 })
    );
  });
});
