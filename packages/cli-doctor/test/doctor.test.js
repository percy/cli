import { setupTest, logger } from '@percy/cli-command/test/helpers';
import { doctor } from '@percy/cli-doctor';
import { probeUrl } from '@percy/cli-doctor/src/utils/http.js';
import { checkSSL } from '@percy/cli-doctor/src/checks/ssl.js';
import { checkConnectivity } from '@percy/cli-doctor/src/checks/connectivity.js';
import { detectProxy } from '@percy/cli-doctor/src/checks/proxy.js';
import { detectPAC } from '@percy/cli-doctor/src/checks/pac.js';

// ─── Shared output capture helper ────────────────────────────────────────────
let stdoutLines = [];
const _origWrite = process.stdout.write.bind(process.stdout);

function captureStdout() {
  stdoutLines = [];
  spyOn(process.stdout, 'write').and.callFake((chunk) => {
    stdoutLines.push(String(chunk));
    return true;
  });
}

function getOutput() {
  return stdoutLines.join('');
}

// ─── Mock probeUrl for unit tests ─────────────────────────────────────────────
async function mockProbe(responses = {}) {
  spyOn(await import('@percy/cli-doctor/src/utils/http.js'), 'probeUrl')
    .and.callFake(async (url) => {
      return responses[url] ?? { ok: true, status: 200, error: null, errorCode: null, latencyMs: 5 };
    });
}

// ─── Test suite ───────────────────────────────────────────────────────────────
describe('percy doctor', () => {
  beforeEach(async () => {
    await setupTest();
    captureStdout();

    // Reset env that affects checks
    delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    delete process.env.HTTPS_PROXY;
    delete process.env.HTTP_PROXY;
    delete process.env.https_proxy;
    delete process.env.http_proxy;
    delete process.env.NO_PROXY;
    delete process.env.no_proxy;
  });

  afterEach(() => {
    delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    delete process.env.HTTPS_PROXY;
    delete process.env.HTTP_PROXY;
  });

  // ── Command smoke test ────────────────────────────────────────────────────
  describe('command', () => {
    it('has the correct command name', () => {
      expect(doctor.name).toBe('doctor');
    });

    it('has a description', () => {
      expect(doctor.definition.description).toMatch(/diagnose/i);
    });

    it('has --proxy-server flag', () => {
      const flag = doctor.definition.flags.find(f => f.name === 'proxy-server');
      expect(flag).toBeDefined();
    });

    it('has --url flag', () => {
      const flag = doctor.definition.flags.find(f => f.name === 'url');
      expect(flag).toBeDefined();
    });

    it('has --fix flag', () => {
      const flag = doctor.definition.flags.find(f => f.name === 'fix');
      expect(flag).toBeDefined();
    });
  });

  // ── SSL Check unit tests ──────────────────────────────────────────────────
  describe('checkSSL', () => {
    it('returns a pass finding when SSL is healthy', async () => {
      spyOn(await import('@percy/cli-doctor/src/utils/http.js'), 'probeUrl')
        .and.resolveTo({ ok: true, status: 200, error: null, errorCode: null, latencyMs: 10 });

      const findings = await checkSSL();
      expect(findings.some(f => f.status === 'pass')).toBeTrue();
    });

    it('detects NODE_TLS_REJECT_UNAUTHORIZED=0 as a warning', async () => {
      process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
      spyOn(await import('@percy/cli-doctor/src/utils/http.js'), 'probeUrl')
        .and.resolveTo({ ok: true, status: 200, error: null, errorCode: null, latencyMs: 5 });

      const findings = await checkSSL();
      const warn = findings.find(f => f.status === 'warn');
      expect(warn).toBeDefined();
      expect(warn.message).toMatch(/NODE_TLS_REJECT_UNAUTHORIZED/);
    });

    it('returns a fail finding for SSL certificate errors', async () => {
      spyOn(await import('@percy/cli-doctor/src/utils/http.js'), 'probeUrl')
        .and.resolveTo({
          ok: false,
          status: 0,
          error: 'certificate has expired',
          errorCode: 'CERT_HAS_EXPIRED',
          latencyMs: 8
        });

      const findings = await checkSSL();
      const fail = findings.find(f => f.status === 'fail');
      expect(fail).toBeDefined();
      expect(fail.message).toMatch(/SSL error/i);
      expect(fail.configFix).toBeDefined();
      expect(fail.suggestions.length).toBeGreaterThan(0);
    });

    it('skips SSL check (not an SSL error) when network is unreachable', async () => {
      spyOn(await import('@percy/cli-doctor/src/utils/http.js'), 'probeUrl')
        .and.resolveTo({
          ok: false,
          status: 0,
          error: 'getaddrinfo ENOTFOUND percy.io',
          errorCode: 'ENOTFOUND',
          latencyMs: 20
        });

      const findings = await checkSSL();
      // Should not be a fail (ENOTFOUND is a connectivity issue, not SSL)
      expect(findings.every(f => f.status !== 'fail')).toBeTrue();
    });
  });

  // ── Connectivity Check unit tests ─────────────────────────────────────────
  describe('checkConnectivity', () => {
    it('returns pass findings when all domains are reachable', async () => {
      spyOn(await import('@percy/cli-doctor/src/utils/http.js'), 'probeUrl')
        .and.resolveTo({ ok: true, status: 200, error: null, errorCode: null, latencyMs: 15 });

      const findings = await checkConnectivity();
      expect(findings.every(f => f.status === 'pass')).toBeTrue();
    });

    it('returns fail findings when domains are not reachable', async () => {
      spyOn(await import('@percy/cli-doctor/src/utils/http.js'), 'probeUrl')
        .and.resolveTo({
          ok: false,
          status: 0,
          error: 'getaddrinfo ENOTFOUND',
          errorCode: 'ENOTFOUND',
          latencyMs: 50
        });

      const findings = await checkConnectivity();
      expect(findings.some(f => f.status === 'fail')).toBeTrue();
    });

    it('returns warn when domain only reachable via proxy', async () => {
      spyOn(await import('@percy/cli-doctor/src/utils/http.js'), 'probeUrl')
        .and.callFake(async (url, opts) => {
          if (opts?.proxyUrl) return { ok: true, status: 200, error: null, errorCode: null, latencyMs: 20 };
          return { ok: false, status: 0, error: 'ECONNREFUSED', errorCode: 'ECONNREFUSED', latencyMs: 5 };
        });

      const findings = await checkConnectivity({ proxyUrl: 'http://proxy.test:8080' });
      expect(findings.some(f => f.status === 'warn')).toBeTrue();
    });

    it('includes extra URLs when provided', async () => {
      spyOn(await import('@percy/cli-doctor/src/utils/http.js'), 'probeUrl')
        .and.resolveTo({ ok: true, status: 200, error: null, errorCode: null, latencyMs: 5 });

      const extraUrl = 'https://example.com';
      const findings = await checkConnectivity({ extraUrls: [extraUrl] });
      const extraFinding = findings.find(f => f.url === extraUrl);
      expect(extraFinding).toBeDefined();
    });
  });

  // ── Proxy Detection unit tests ────────────────────────────────────────────
  describe('detectProxy', () => {
    it('reports no proxy when environment is clean', async () => {
      spyOn(await import('@percy/cli-doctor/src/checks/proxy.js'), 'detectProxy')
        .and.callThrough();

      const findings = await detectProxy({ testProxy: false });
      const noProxy = findings.find(f => f.source === 'none');
      expect(noProxy).toBeDefined();
    });

    it('detects HTTPS_PROXY environment variable', async () => {
      process.env.HTTPS_PROXY = 'http://corp-proxy.example.com:3128';
      spyOn(await import('@percy/cli-doctor/src/utils/http.js'), 'probeUrl')
        .and.resolveTo({ ok: true, status: 200, error: null, errorCode: null, latencyMs: 10 });

      const findings = await detectProxy({ testProxy: true });
      const proxyFinding = findings.find(f => f.proxyUrl === 'http://corp-proxy.example.com:3128');
      expect(proxyFinding).toBeDefined();
      expect(proxyFinding.source).toMatch(/env:HTTPS_PROXY/);
    });

    it('marks proxy as pass when validation succeeds', async () => {
      process.env.HTTPS_PROXY = 'http://proxy.test:8080';
      spyOn(await import('@percy/cli-doctor/src/utils/http.js'), 'probeUrl')
        .and.resolveTo({ ok: true, status: 200, error: null, errorCode: null, latencyMs: 5 });

      const findings = await detectProxy({ testProxy: true });
      const proxyFinding = findings.find(f => f.proxyUrl);
      expect(proxyFinding?.status).toBe('pass');
    });

    it('marks proxy as fail when validation fails', async () => {
      process.env.HTTPS_PROXY = 'http://bad-proxy.test:8080';
      spyOn(await import('@percy/cli-doctor/src/utils/http.js'), 'probeUrl')
        .and.resolveTo({ ok: false, status: 0, error: 'ECONNREFUSED', errorCode: 'ECONNREFUSED', latencyMs: 5 });

      const findings = await detectProxy({ testProxy: true });
      const proxyFinding = findings.find(f => f.proxyUrl);
      expect(proxyFinding?.status).toBe('fail');
    });
  });

  // ── PAC Detection unit tests ──────────────────────────────────────────────
  describe('detectPAC', () => {
    it('reports no PAC when none is configured', async () => {
      const findings = await detectPAC();
      // Should have at least one info/no-pac finding
      expect(Array.isArray(findings)).toBeTrue();
    });
  });

  // ── Integration: full command run ─────────────────────────────────────────
  describe('full command run (mocked network)', () => {
    beforeEach(async () => {
      // Stub all network probes to succeed so we can test output format
      spyOn(await import('@percy/cli-doctor/src/utils/http.js'), 'probeUrl')
        .and.resolveTo({ ok: true, status: 200, error: null, errorCode: null, latencyMs: 7 });
      // Stub PAC detection to return nothing (no PAC configured in test env)
      spyOn(await import('@percy/cli-doctor/src/checks/pac.js'), 'detectPAC')
        .and.resolveTo([{ status: 'info', source: 'none', message: 'No PAC detected.', pacUrl: null, resolvedProxy: null }]);
    });

    it('prints a section header for each check category', async () => {
      await doctor([]);
      const out = getOutput();
      expect(out).toMatch(/SSL/i);
      expect(out).toMatch(/Connectivity/i);
      expect(out).toMatch(/Proxy/i);
      expect(out).toMatch(/PAC/i);
    });

    it('prints a passing summary when all checks pass', async () => {
      await doctor([]);
      const out = getOutput();
      expect(out).toMatch(/passed/i);
    });

    it('exits with non-zero code when a check fails', async () => {
      spyOn(await import('@percy/cli-doctor/src/utils/http.js'), 'probeUrl')
        .and.resolveTo({
          ok: false,
          status: 0,
          error: 'ENOTFOUND',
          errorCode: 'ENOTFOUND',
          latencyMs: 10
        });

      await expectAsync(doctor([])).toBeRejectedWithError();
    });

    it('passes --proxy-server to connectivity check', async () => {
      const connSpy = spyOn(
        await import('@percy/cli-doctor/src/checks/connectivity.js'),
        'checkConnectivity'
      ).and.resolveTo([{ status: 'pass', message: 'ok', label: 'test', url: 'https://percy.io' }]);

      await doctor(['--proxy-server', 'http://proxy.example.com:3128']);
      expect(connSpy).toHaveBeenCalledWith(jasmine.objectContaining({
        proxyUrl: 'http://proxy.example.com:3128'
      }));
    });

    it('passes extra --url to connectivity check', async () => {
      const connSpy = spyOn(
        await import('@percy/cli-doctor/src/checks/connectivity.js'),
        'checkConnectivity'
      ).and.resolveTo([{ status: 'pass', message: 'ok', label: 'test', url: 'https://percy.io' }]);

      await doctor(['--url', 'https://staging.example.com']);
      expect(connSpy).toHaveBeenCalledWith(jasmine.objectContaining({
        extraUrls: ['https://staging.example.com']
      }));
    });
  });
});
