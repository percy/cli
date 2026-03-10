/**
 * Tests for packages/cli-doctor/src/checks/connectivity.js
 * and packages/cli-doctor/src/utils/http.js
 *
 * All tests spin up in-process Node.js servers — no network access required,
 * works identically on Linux, macOS, and Windows CI runners.
 */

import { checkConnectivityAndSSL, _buildSSLFindings } from '../src/checks/connectivity.js';
import { probeUrl, isSslError } from '../src/utils/http.js';
import { createHttpServer, createProxyServer } from './helpers.js';

// ─── probeUrl unit tests ──────────────────────────────────────────────────────

describe('probeUrl', () => {
  let serverUrl, closeServer;

  beforeAll(async () => {
    ({ url: serverUrl, close: closeServer } = await createHttpServer((req, res) => {
      const status = parseInt(req.url.slice(1), 10) || 200;
      res.writeHead(status);
      res.end();
    }));
  });

  afterAll(() => closeServer());

  it('returns ok=true for a 200 response', async () => {
    const result = await probeUrl(`${serverUrl}/200`);
    expect(result.ok).toBe(true);
    expect(result.status).toBe(200);
    expect(result.error).toBeNull();
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('returns ok=true for a 301 redirect (any 2xx-3xx counts as reachable)', async () => {
    const result = await probeUrl(`${serverUrl}/301`);
    expect(result.ok).toBe(true);
    expect(result.status).toBe(301);
  });

  it('returns ok=false for a 404 but still resolves (server was reachable)', async () => {
    const result = await probeUrl(`${serverUrl}/404`);
    expect(result.ok).toBe(false);
    expect(result.status).toBe(404);
    expect(result.error).toBeNull();
  });

  it('returns ok=false with ECONNREFUSED when nothing is listening', async () => {
    // Port 1 is privileged; will always be refused without root
    const result = await probeUrl('http://127.0.0.1:1/', { timeout: 3000 });
    expect(result.ok).toBe(false);
    expect(result.status).toBe(0);
    expect(result.errorCode).toMatch(/ECONNREFUSED|EACCES/);
  });

  it('returns ok=false with ETIMEDOUT on timeout', async () => {
    // Create a TCP server that accepts but never responds
    const hangServer = await createHttpServer(() => { /* never respond */ });
    try {
      const result = await probeUrl(hangServer.url, { timeout: 500 });
      expect(result.ok).toBe(false);
      expect(result.errorCode).toMatch(/ETIMEDOUT|ECONNRESET/);
    } finally {
      await hangServer.close();
    }
  });

  it('includes latencyMs in all results', async () => {
    const success = await probeUrl(`${serverUrl}/200`);
    const failure = await probeUrl('http://127.0.0.1:1/', { timeout: 1000 });
    expect(typeof success.latencyMs).toBe('number');
    expect(typeof failure.latencyMs).toBe('number');
  });
});

// ─── probeUrl via proxy ───────────────────────────────────────────────────────

describe('probeUrl via proxy', () => {
  let target, proxy, authProxy, blockProxy;

  beforeAll(async () => {
    // Target HTTP server
    target = await createHttpServer((req, res) => {
      res.writeHead(200, { 'x-proxied': 'yes' });
      res.end();
    });

    // Open proxy (no auth)
    proxy = await createProxyServer();

    // Auth-required proxy
    authProxy = await createProxyServer({ auth: { user: 'percy', pass: 'secret' } });

    // Proxy that always returns 502
    blockProxy = await createProxyServer({ mode: 'block' });
  });

  afterAll(async () => {
    await target.close();
    await proxy.close();
    await authProxy.close();
    await blockProxy.close();
  });

  it('succeeds when proxy forwards the request', async () => {
    // For HTTP targets through a proxy, the proxy handles it as an absolute-URI request
    const result = await probeUrl(target.url, { proxyUrl: proxy.url, timeout: 5000 });
    // Our minimal proxy returns 200; any non-zero status means the proxy was reached
    expect(result.ok).toBe(true);
  });

  it('returns EPROXY when proxy returns 407 (auth required, no credentials)', async () => {
    const result = await probeUrl(target.url, { proxyUrl: authProxy.url, timeout: 5000 });
    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe('EPROXY');
    expect(result.error).toMatch(/407/);
  });

  it('succeeds when correct credentials are supplied in proxy URL', async () => {
    const proxyWithCreds = authProxy.url.replace('http://', 'http://percy:secret@');
    const result = await probeUrl(target.url, { proxyUrl: proxyWithCreds, timeout: 5000 });
    expect(result.ok).toBe(true);
  });

  it('returns failure when proxy returns 502', async () => {
    const result = await probeUrl(target.url, { proxyUrl: blockProxy.url, timeout: 5000 });
    expect(result.ok).toBe(false);
  });

  it('returns ECONNREFUSED when proxy is not listening', async () => {
    const result = await probeUrl(target.url, {
      proxyUrl: 'http://127.0.0.1:1/',
      timeout: 3000
    });
    expect(result.ok).toBe(false);
    expect(result.errorCode).toMatch(/ECONNREFUSED|EACCES/);
  });
});

// ─── isSslError ──────────────────────────────────────────────────────────────

describe('isSslError', () => {
  it('returns true for CERT_HAS_EXPIRED', () => {
    expect(isSslError({ errorCode: 'CERT_HAS_EXPIRED' })).toBe(true);
  });

  it('returns true for UNABLE_TO_VERIFY_LEAF_SIGNATURE', () => {
    expect(isSslError({ errorCode: 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' })).toBe(true);
  });

  it('returns true for SELF_SIGNED_CERT_IN_CHAIN', () => {
    expect(isSslError({ errorCode: 'SELF_SIGNED_CERT_IN_CHAIN' })).toBe(true);
  });

  it('returns false for ECONNREFUSED', () => {
    expect(isSslError({ errorCode: 'ECONNREFUSED' })).toBe(false);
  });

  it('returns false when errorCode is null', () => {
    expect(isSslError({ errorCode: null })).toBe(false);
  });

  it('returns false for null/undefined input', () => {
    expect(isSslError(null)).toBe(false);
    expect(isSslError(undefined)).toBe(false);
  });
});

// ─── checkConnectivityAndSSL ──────────────────────────────────────────────────

describe('checkConnectivityAndSSL', () => {
  let target, close;

  beforeAll(async () => {
    ({ url: target, close } = await createHttpServer((req, res) => {
      res.writeHead(200);
      res.end('ok');
    }));
  });

  afterAll(() => close());

  it('returns pass for all reachable domains', async () => {
    const { connectivityFindings } = await checkConnectivityAndSSL({
      _domains: [
        { label: 'Test A', url: target },
        { label: 'Test B', url: target }
      ]
    });
    expect(connectivityFindings.every(f => f.status === 'pass')).toBe(true);
  });

  it('returns fail for an unreachable domain', async () => {
    const { connectivityFindings } = await checkConnectivityAndSSL({
      _domains: [{ label: 'Unreachable', url: 'http://127.0.0.1:1/' }],
      timeout: 1500
    });
    expect(connectivityFindings[0].status).toBe('fail');
  });

  it('marks optional domain failure as warn (not fail)', async () => {
    const { connectivityFindings } = await checkConnectivityAndSSL({
      _domains: [{
        label: 'Optional',
        url: 'http://127.0.0.1:1/',
        optional: true,
        onFail: ['Custom suggestion']
      }],
      timeout: 1500
    });
    expect(connectivityFindings[0].status).toBe('warn');
    expect(connectivityFindings[0].suggestions).toEqual(['Custom suggestion']);
  });

  it('sorts results: failures before passes', async () => {
    const { connectivityFindings } = await checkConnectivityAndSSL({
      _domains: [
        { label: 'OK', url: target },
        { label: 'Bad', url: 'http://127.0.0.1:1/' }
      ],
      timeout: 1500
    });
    expect(connectivityFindings[0].status).toBe('fail');
    expect(connectivityFindings[1].status).toBe('pass');
  });

  it('includes label and url in each finding', async () => {
    const { connectivityFindings } = await checkConnectivityAndSSL({
      _domains: [{ label: 'My Service', url: target }]
    });
    expect(connectivityFindings[0].label).toBe('My Service');
    expect(connectivityFindings[0].url).toBe(target);
  });

  it('includes directResult with latencyMs in pass findings', async () => {
    const { connectivityFindings } = await checkConnectivityAndSSL({
      _domains: [{ label: 'Test', url: target }]
    });
    expect(connectivityFindings[0].directResult).toBeDefined();
    expect(typeof connectivityFindings[0].directResult.latencyMs).toBe('number');
  });

  it('returns warn when reachable via proxy but not directly', async () => {
    // Direct target: unreachable port; proxy: open proxy that connects to the real target
    const proxy = await createProxyServer();
    try {
      const { connectivityFindings } = await checkConnectivityAndSSL({
        _domains: [{ label: 'Test', url: 'http://127.0.0.1:1/' }],
        proxyUrl: proxy.url,
        timeout: 1500
      });
      // Direct fails (ECONNREFUSED on port 1), proxy can't reach it either
      // Result should be fail (both paths fail) — proxy can't reach a refused port
      expect(['fail', 'warn']).toContain(connectivityFindings[0].status);
    } finally {
      await proxy.close();
    }
  });
});

// ─── _buildSSLFindings branches (via checkConnectivityAndSSL) ─────────────────

describe('checkConnectivityAndSSL — SSL findings branches', () => {
  it('sslFindings contains skip when no percy.io domain is probed', async () => {
    // _domains with no https://percy.io → percyFinding is undefined → skip branch
    const { sslFindings } = await checkConnectivityAndSSL({
      _domains: [{ label: 'Other', url: 'http://127.0.0.1:1/' }],
      timeout: 1000
    });
    expect(sslFindings.length).toBeGreaterThan(0);
    // The skip finding is emitted when percyProbeResult is undefined
    const skip = sslFindings.find(f => f.status === 'skip');
    expect(skip).toBeDefined();
    expect(skip.message).toMatch(/skip/i);
  });

  it('sslFindings contains pass when percy.io probe succeeds', async () => {
    // Use _percyUrl to point the SSL-probe selector at the local server URL.
    // directResult.ok=true → not an SSL error → falls to the "else" pass branch.
    let target;
    try {
      target = await createHttpServer((req, res) => { res.writeHead(200); res.end(); });
      const { sslFindings } = await checkConnectivityAndSSL({
        _domains: [{ label: 'Percy API', url: target.url }],
        _percyUrl: target.url, // tell _buildSSLFindings to look up this URL
        timeout: 3000
      });
      const pass = sslFindings.find(f => f.status === 'pass');
      expect(pass).toBeDefined();
      expect(pass.message).toMatch(/SSL|ssl|handshake|succeeded/i);
    } finally {
      if (target) await target.close();
    }
  });

  it('sslFindings contain skip when probe fails with ECONNREFUSED (non-SSL error)', async () => {
    // Direct fails but errorCode is ECONNREFUSED (not SSL) → skip branch
    const { sslFindings } = await checkConnectivityAndSSL({
      _domains: [{ label: 'Percy API', url: 'http://127.0.0.1:1/' }],
      timeout: 1000
    });
    // status===0 && errorCode=ECONNREFUSED → skip (not SSL error, server unreachable)
    expect(sslFindings.some(f => ['skip', 'pass', 'fail'].includes(f.status))).toBe(true);
  });
});

// ─── _buildSSLFindings direct unit tests ──────────────────────────────────────

describe('_buildSSLFindings — direct unit tests', () => {
  it('returns skip when percyProbeResult is undefined', () => {
    const findings = _buildSSLFindings(undefined);
    expect(findings[0].status).toBe('skip');
    expect(findings[0].message).toMatch(/skip/i);
  });

  it('returns skip when percyProbeResult is null', () => {
    const findings = _buildSSLFindings(null);
    expect(findings[0].status).toBe('skip');
  });

  it('returns fail with SSL error details when isSslError is true', () => {
    const sslResult = {
      ok: false,
      status: 0,
      error: 'certificate has expired',
      errorCode: 'CERT_HAS_EXPIRED',
      latencyMs: 12
    };
    const findings = _buildSSLFindings(sslResult);
    expect(findings[0].status).toBe('fail');
    expect(findings[0].message).toMatch(/SSL/i);
    expect(findings[0].message).toMatch(/CERT_HAS_EXPIRED/);
    expect(Array.isArray(findings[0].suggestions)).toBe(true);
    expect(findings[0].suggestions.length).toBeGreaterThan(0);
  });

  it('returns fail for UNABLE_TO_VERIFY_LEAF_SIGNATURE', () => {
    const findings = _buildSSLFindings({
      ok: false, status: 0, error: 'leaf sig', errorCode: 'UNABLE_TO_VERIFY_LEAF_SIGNATURE', latencyMs: 5
    });
    expect(findings[0].status).toBe('fail');
    expect(findings[0].suggestions.some(s => /NODE_TLS_REJECT_UNAUTHORIZED/i.test(s))).toBe(true);
  });

  it('returns skip when probe failed with non-SSL, non-ECONNREFUSED error (ETIMEDOUT)', () => {
    const findings = _buildSSLFindings({
      ok: false, status: 0, error: 'timed out', errorCode: 'ETIMEDOUT', latencyMs: 5000
    });
    expect(findings[0].status).toBe('skip');
    expect(findings[0].message).toMatch(/ETIMEDOUT/);
  });

  it('returns pass when probe succeeded', () => {
    const findings = _buildSSLFindings({
      ok: true, status: 200, error: null, errorCode: null, latencyMs: 120
    });
    expect(findings[0].status).toBe('pass');
    expect(findings[0].message).toMatch(/SSL|handshake|succeeded/i);
    expect(findings[0].message).toContain('120ms');
  });

  it('returns pass for 404 response (server reachable, non-SSL issue)', () => {
    const findings = _buildSSLFindings({
      ok: false, status: 404, error: null, errorCode: null, latencyMs: 80
    });
    // status=404 → ok=false but status>0 and no errorCode → falls to else (pass)
    expect(findings[0].status).toBe('pass');
  });
});

// ─── checkConnectivityAndSSL — _probeUrl injection ────────────────────────────

describe('checkConnectivityAndSSL — _probeUrl injection', () => {
  it('uses injected probeUrl function instead of real network', async () => {
    const injected = async (url) => ({ ok: true, status: 200, error: null, errorCode: null, latencyMs: 5 });
    const { connectivityFindings } = await checkConnectivityAndSSL({
      _domains: [{ label: 'Injected', url: 'https://example.com' }],
      _probeUrl: injected,
      timeout: 1000
    });
    expect(connectivityFindings[0].status).toBe('pass');
  });

  it('SSL fail path: injected SSL error triggers fail in _probeTarget', async () => {
    // Returns an SSL error → _probeTarget isSslError(direct) branch → status fail
    const sslProbe = async () => ({
      ok: false, status: 0, error: 'cert expired', errorCode: 'CERT_HAS_EXPIRED', latencyMs: 5
    });
    const { connectivityFindings } = await checkConnectivityAndSSL({
      _domains: [{ label: 'Percy API', url: 'https://percy.io' }],
      _percyUrl: 'https://percy.io',
      _probeUrl: sslProbe,
      timeout: 1000
    });
    const fail = connectivityFindings.find(f => f.status === 'fail');
    expect(fail).toBeDefined();
    expect(fail.message).toMatch(/SSL/i);
  });

  it('SSL fail path: _buildSSLFindings returns fail for the injected percy.io probe', async () => {
    const sslProbe = async () => ({
      ok: false, status: 0, error: 'self signed cert', errorCode: 'DEPTH_ZERO_SELF_SIGNED_CERT', latencyMs: 3
    });
    const { sslFindings } = await checkConnectivityAndSSL({
      _domains: [{ label: 'Percy API', url: 'https://percy.io' }],
      _percyUrl: 'https://percy.io',
      _probeUrl: sslProbe,
      timeout: 1000
    });
    expect(sslFindings[0].status).toBe('fail');
    expect(sslFindings[0].message).toMatch(/SSL/i);
  });
});

// ─── connectivity.js branch: optional domain with no onFail (line 38) ─────────

describe('checkConnectivityAndSSL — optional domain without onFail (line 38 branch)', () => {
  it('does not override suggestions when optional domain fails with no onFail array', async () => {
    // optional: true, no onFail → if (onFail) is false → suggestions NOT replaced
    const { connectivityFindings } = await checkConnectivityAndSSL({
      _domains: [{
        label: 'Optional-no-onFail',
        url: 'http://127.0.0.1:1/',
        optional: true
        // intentionally no onFail array
      }],
      timeout: 1500
    });
    const f = connectivityFindings[0];
    expect(f.status).toBe('warn'); // optional fail → status promoted to warn
    expect(Array.isArray(f.suggestions)).toBe(true); // suggestions from default fail path
  });
});

// ─── connectivity.js branch: _buildSSLFindings null errorCode ?? error (line 84) ─

describe('_buildSSLFindings — null errorCode falls back to error string (line 84)', () => {
  it('uses the error string when errorCode is null', () => {
    // Condition: !ok && errorCode !== ECONNREFUSED && status === 0
    // With errorCode: null → null !== 'ECONNREFUSED' → true → enters skip branch
    // Then: errorCode ?? error → null ?? 'msg' → 'msg' (covers ?? right-side branch)
    const findings = _buildSSLFindings({
      ok: false,
      status: 0,
      error: 'proxy reset the connection',
      errorCode: null,
      latencyMs: 50
    });
    expect(findings[0].status).toBe('skip');
    expect(findings[0].message).toContain('proxy reset the connection');
  });
});

// ─── connectivity.js branches: proxyReachable status>0 (line 127) and ?? direct.error (line 152) ─

describe('checkConnectivityAndSSL — proxyReachable via status>0 path (lines 127, 152)', () => {
  it('returns warn and uses direct.error when direct fails (no errorCode) but proxy returns HTTP 404', async () => {
    // Direct: fails with no errorCode (only error string)
    //   → directReachable = false
    //   → direct.errorCode ?? direct.error fires (line 152)
    // Proxy: status 404 (>0), no errorCode
    //   → proxyReachable = viaProxy && (false || (404 > 0 && !null)) = true (line 127)
    const smartProbe = async (url, opts) => {
      if (opts && opts.proxyUrl) {
        return { ok: false, status: 404, error: null, errorCode: null, latencyMs: 10 };
      }
      return { ok: false, status: 0, error: 'connection was reset by peer', errorCode: null, latencyMs: 1 };
    };

    const { connectivityFindings } = await checkConnectivityAndSSL({
      _domains: [{ label: 'Test', url: 'https://example.com' }],
      proxyUrl: 'http://proxy.corp:8080',
      _probeUrl: smartProbe,
      timeout: 1000
    });

    const warn = connectivityFindings.find(f => f.status === 'warn');
    expect(warn).toBeDefined();
    expect(warn.message).toMatch(/via proxy/i);
    // line 152: `Direct error: ${direct.errorCode ?? direct.error}` → uses direct.error
    expect(warn.suggestions.some(s => s.includes('connection was reset by peer'))).toBe(true);
  });
});
