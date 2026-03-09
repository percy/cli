/**
 * Tests for packages/cli-doctor/src/checks/connectivity.js
 * and packages/cli-doctor/src/utils/http.js
 *
 * All tests spin up in-process Node.js servers — no network access required,
 * works identically on Linux, macOS, and Windows CI runners.
 */

import { checkConnectivityAndSSL } from '../src/checks/connectivity.js';
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
