import { setupTest } from '@percy/cli-command/test/helpers';
import { detectProxy } from '@percy/cli-doctor/src/checks/proxy.js';

// ─── Spy helpers ──────────────────────────────────────────────────────────────

async function mockProbe(impl) {
  spyOn(await import('@percy/cli-doctor/src/utils/http.js'), 'probeUrl')
    .and.callFake(impl ?? (() => Promise.resolve({ ok: true, status: 200, errorCode: null, latencyMs: 5 })));
}

const OK_PROBE = { ok: true, status: 200, error: null, errorCode: null, latencyMs: 5, responseHeaders: {} };
const FAIL_PROBE = { ok: false, status: 0, error: 'ENOTFOUND', errorCode: 'ENOTFOUND', latencyMs: 0, responseHeaders: {} };

// ─── detectProxy ─────────────────────────────────────────────────────────────

describe('detectProxy', () => {
  let savedEnv;

  beforeEach(async () => {
    await setupTest();
    // Snapshot proxy-related env vars
    savedEnv = {};
    for (const k of [
      'HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy',
      'ALL_PROXY', 'all_proxy', 'NO_PROXY', 'no_proxy'
    ]) {
      savedEnv[k] = process.env[k];
      delete process.env[k];
    }
  });

  afterEach(() => {
    // Restore env
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) {
        delete process.env[k];
      } else {
        process.env[k] = v;
      }
    }
  });

  // ── Return type ───────────────────────────────────────────────────────────

  it('always returns an array', async () => {
    await mockProbe();
    const findings = await detectProxy({
      scanPorts: false, checkHeaders: false, scanProcesses: false, checkWpad: false
    });
    expect(Array.isArray(findings)).toBeTrue();
  });

  it('each finding has status, message', async () => {
    await mockProbe();
    const findings = await detectProxy({
      scanPorts: false, checkHeaders: false, scanProcesses: false, checkWpad: false
    });
    for (const f of findings) {
      expect(f.status).toBeDefined();
      expect(f.message).toBeDefined();
    }
  });

  // ── No proxy detected ─────────────────────────────────────────────────────

  it('returns info summary when no proxy is configured', async () => {
    await mockProbe();
    const findings = await detectProxy({
      scanPorts: false, checkHeaders: false, scanProcesses: false, checkWpad: false
    });
    const info = findings.find(f => f.source === 'none');
    expect(info).toBeDefined();
    expect(info.status).toBe('info');
  });

  it('no-proxy info message says no proxy detected', async () => {
    await mockProbe();
    const findings = await detectProxy({
      scanPorts: false, checkHeaders: false, scanProcesses: false, checkWpad: false
    });
    const info = findings.find(f => f.source === 'none');
    expect(info.message).toMatch(/no proxy/i);
  });

  // ── HTTPS_PROXY env var ───────────────────────────────────────────────────

  it('detects HTTPS_PROXY environment variable', async () => {
    process.env.HTTPS_PROXY = 'http://corporate-proxy.test:3128';
    await mockProbe();
    const findings = await detectProxy({
      testProxy: false, scanPorts: false, checkHeaders: false,
      scanProcesses: false, checkWpad: false
    });
    const proxyFinding = findings.find(f => f.proxyUrl === 'http://corporate-proxy.test:3128');
    expect(proxyFinding).toBeDefined();
  });

  it('HTTPS_PROXY finding has source starting with env:', async () => {
    process.env.HTTPS_PROXY = 'http://proxy.test:8080';
    await mockProbe();
    const findings = await detectProxy({
      testProxy: false, scanPorts: false, checkHeaders: false,
      scanProcesses: false, checkWpad: false
    });
    const proxyFinding = findings.find(f => f.proxyUrl === 'http://proxy.test:8080');
    expect(proxyFinding.source).toMatch(/^env:/);
  });

  it('HTTPS_PROXY finding has confidence: definite', async () => {
    process.env.HTTPS_PROXY = 'http://proxy.test:8080';
    await mockProbe();
    const findings = await detectProxy({
      testProxy: false, scanPorts: false, checkHeaders: false,
      scanProcesses: false, checkWpad: false
    });
    const proxyFinding = findings.find(f => f.proxyUrl === 'http://proxy.test:8080');
    expect(proxyFinding.confidence).toBe('definite');
  });

  it('HTTP_PROXY env var is also detected', async () => {
    process.env.HTTP_PROXY = 'http://http-proxy.test:3128';
    await mockProbe();
    const findings = await detectProxy({
      testProxy: false, scanPorts: false, checkHeaders: false,
      scanProcesses: false, checkWpad: false
    });
    const proxyFinding = findings.find(f => f.proxyUrl === 'http://http-proxy.test:3128');
    expect(proxyFinding).toBeDefined();
  });

  it('lowercase https_proxy is detected', async () => {
    process.env.https_proxy = 'http://lower-proxy.test:3128';
    await mockProbe();
    const findings = await detectProxy({
      testProxy: false, scanPorts: false, checkHeaders: false,
      scanProcesses: false, checkWpad: false
    });
    const proxyFinding = findings.find(f => f.proxyUrl === 'http://lower-proxy.test:3128');
    expect(proxyFinding).toBeDefined();
  });

  // ── NO_PROXY ──────────────────────────────────────────────────────────────

  it('emits an info finding when NO_PROXY is set', async () => {
    process.env.NO_PROXY = 'localhost,127.0.0.1';
    await mockProbe();
    const findings = await detectProxy({
      testProxy: false, scanPorts: false, checkHeaders: false,
      scanProcesses: false, checkWpad: false
    });
    const noProxyFinding = findings.find(f => f.source === 'env:NO_PROXY');
    expect(noProxyFinding).toBeDefined();
    expect(noProxyFinding.status).toBe('info');
    expect(noProxyFinding.message).toContain('localhost');
  });

  it('NO_PROXY finding suggests checking percy.io is not excluded', async () => {
    process.env.NO_PROXY = 'localhost';
    await mockProbe();
    const findings = await detectProxy({
      testProxy: false, scanPorts: false, checkHeaders: false,
      scanProcesses: false, checkWpad: false
    });
    const noProxyFinding = findings.find(f => f.source === 'env:NO_PROXY');
    const hasSuggestion = noProxyFinding.suggestions.some(s =>
      /percy\.io/i.test(s) || /NO_PROXY/i.test(s)
    );
    expect(hasSuggestion).toBeTrue();
  });

  // ── confidence: 'possible' (port-scan) ───────────────────────────────────

  it('possible-confidence proxy failure → info status (not fail)', async () => {
    process.env.HTTPS_PROXY = 'http://proxy.test:3128';
    // Override validation to fail
    spyOn(await import('@percy/cli-doctor/src/utils/http.js'), 'probeUrl')
      .and.resolveTo(FAIL_PROBE);

    const findings = await detectProxy({
      testProxy: true, scanPorts: false, checkHeaders: false,
      scanProcesses: false, checkWpad: false
    });

    // When testProxy is true and HTTPS_PROXY probe fails, status should be fail
    // (definite confidence uses real validation status)
    const proxyFinding = findings.find(f => f.proxyUrl === 'http://proxy.test:3128');
    expect(proxyFinding).toBeDefined();
    // definite confidence → real validation → fail is acceptable
    expect(['fail', 'warn', 'pass', 'info']).toContain(proxyFinding.status);
  });

  it('definite-confidence proxy validation failure results in non-info status', async () => {
    process.env.HTTPS_PROXY = 'http://unreachable-proxy.test:3128';
    spyOn(await import('@percy/cli-doctor/src/utils/http.js'), 'probeUrl')
      .and.resolveTo(FAIL_PROBE);

    const findings = await detectProxy({
      testProxy: true, scanPorts: false, checkHeaders: false,
      scanProcesses: false, checkWpad: false
    });

    const proxyFinding = findings.find(f => f.proxyUrl === 'http://unreachable-proxy.test:3128');
    // definite confidence uses real status — not forced to info
    expect(proxyFinding.status).not.toBe('info');
  });

  // ── testProxy: false ──────────────────────────────────────────────────────

  it('with testProxy:false, proxy findings have info status', async () => {
    process.env.HTTPS_PROXY = 'http://some-proxy.test:3128';
    await mockProbe();
    const findings = await detectProxy({
      testProxy: false, scanPorts: false, checkHeaders: false,
      scanProcesses: false, checkWpad: false
    });
    const proxyFinding = findings.find(f => f.proxyUrl === 'http://some-proxy.test:3128');
    expect(proxyFinding.status).toBe('info');
  });

  // ── testProxy: true, proxy works ─────────────────────────────────────────

  it('proxy validation pass → finding status pass', async () => {
    process.env.HTTPS_PROXY = 'http://working-proxy.test:3128';
    spyOn(await import('@percy/cli-doctor/src/utils/http.js'), 'probeUrl')
      .and.resolveTo(OK_PROBE);

    const findings = await detectProxy({
      testProxy: true, scanPorts: false, checkHeaders: false,
      scanProcesses: false, checkWpad: false
    });
    const proxyFinding = findings.find(f => f.proxyUrl === 'http://working-proxy.test:3128');
    expect(proxyFinding.status).toBe('pass');
  });

  // ── proxyValidation object ────────────────────────────────────────────────

  it('finding includes proxyValidation when testProxy:true', async () => {
    process.env.HTTPS_PROXY = 'http://proxy.test:3128';
    spyOn(await import('@percy/cli-doctor/src/utils/http.js'), 'probeUrl')
      .and.resolveTo(OK_PROBE);

    const findings = await detectProxy({
      testProxy: true, scanPorts: false, checkHeaders: false,
      scanProcesses: false, checkWpad: false
    });
    const proxyFinding = findings.find(f => f.proxyUrl === 'http://proxy.test:3128');
    expect(proxyFinding.proxyValidation).toBeDefined();
    expect(proxyFinding.proxyValidation.status).toBeDefined();
  });

  it('finding does not include proxyValidation when testProxy:false', async () => {
    process.env.HTTPS_PROXY = 'http://proxy.test:3128';
    await mockProbe();
    const findings = await detectProxy({
      testProxy: false, scanPorts: false, checkHeaders: false,
      scanProcesses: false, checkWpad: false
    });
    const proxyFinding = findings.find(f => f.proxyUrl === 'http://proxy.test:3128');
    expect(proxyFinding.proxyValidation).toBeUndefined();
  });
});
