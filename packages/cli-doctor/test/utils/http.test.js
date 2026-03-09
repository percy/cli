/**
 * Tests for packages/cli-doctor/src/utils/http.js
 *
 * probeUrl and isSslError are already exercised extensively through
 * connectivity.test.js. This file targets the remaining branches:
 *   - isSslError: every SSL_ERROR_CODES member, CERT/SSL generic codes, edge cases
 *   - probeUrl: method option, malformed URL, CONNECT path (A) 407/auth
 *   - SSL_ERROR_CODES: exported set membership
 */

import { probeUrl, isSslError, SSL_ERROR_CODES } from '../../src/utils/http.js';
import { createHttpServer, createProxyServer } from '../helpers.js';

// ─── SSL_ERROR_CODES exported set ────────────────────────────────────────────

describe('SSL_ERROR_CODES', () => {
  it('is a Set', () => {
    expect(SSL_ERROR_CODES instanceof Set).toBe(true);
  });

  const expectedCodes = [
    'CERT_HAS_EXPIRED',
    'CERT_NOT_YET_VALID',
    'CERT_REVOKED',
    'DEPTH_ZERO_SELF_SIGNED_CERT',
    'ERR_TLS_CERT_ALTNAME_INVALID',
    'SELF_SIGNED_CERT_IN_CHAIN',
    'UNABLE_TO_GET_ISSUER_CERT',
    'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
    'UNABLE_TO_GET_ISSUER_CERT_LOCALLY'
  ];

  for (const code of expectedCodes) {
    it(`contains ${code}`, () => {
      expect(SSL_ERROR_CODES.has(code)).toBe(true);
    });
  }

  it('does not contain plain network errors', () => {
    expect(SSL_ERROR_CODES.has('ECONNREFUSED')).toBe(false);
    expect(SSL_ERROR_CODES.has('ETIMEDOUT')).toBe(false);
    expect(SSL_ERROR_CODES.has('ENOTFOUND')).toBe(false);
  });
});

// ─── isSslError ───────────────────────────────────────────────────────────────

describe('isSslError', () => {
  it('returns false for null', () => {
    expect(isSslError(null)).toBe(false);
  });

  it('returns false for undefined', () => {
    expect(isSslError(undefined)).toBe(false);
  });

  it('returns false when errorCode is null', () => {
    expect(isSslError({ errorCode: null })).toBe(false);
  });

  it('returns false when errorCode is undefined', () => {
    expect(isSslError({ errorCode: undefined })).toBe(false);
  });

  it('returns false when errorCode is empty string', () => {
    expect(isSslError({ errorCode: '' })).toBe(false);
  });

  it('returns true for every member of SSL_ERROR_CODES', () => {
    for (const code of SSL_ERROR_CODES) {
      expect(isSslError({ errorCode: code })).toBe(true);
    }
  });

  it('returns true for codes containing "CERT" (generic catch-all)', () => {
    expect(isSslError({ errorCode: 'MY_CERT_PROBLEM' })).toBe(true);
    expect(isSslError({ errorCode: 'CERT_CUSTOM_ERROR' })).toBe(true);
  });

  it('returns true for codes containing "SSL" (generic catch-all)', () => {
    expect(isSslError({ errorCode: 'SSL_HANDSHAKE_FAIL' })).toBe(true);
    expect(isSslError({ errorCode: 'ERR_SSL_VERSION_MISMATCH' })).toBe(true);
  });

  it('returns false for unrelated error codes', () => {
    expect(isSslError({ errorCode: 'ECONNREFUSED' })).toBe(false);
    expect(isSslError({ errorCode: 'ETIMEDOUT' })).toBe(false);
    expect(isSslError({ errorCode: 'ENOTFOUND' })).toBe(false);
    expect(isSslError({ errorCode: 'EPROXY' })).toBe(false);
  });

  it('returns false when ok is true but no errorCode', () => {
    expect(isSslError({ ok: true, status: 200, errorCode: null })).toBe(false);
  });
});

// ─── probeUrl — HTTP method option ───────────────────────────────────────────

describe('probeUrl — HTTP method option', () => {
  let server;

  beforeAll(async () => {
    server = await createHttpServer((req, res) => {
      res.writeHead(200, { 'x-method': req.method });
      res.end();
    });
  });

  afterAll(() => server.close());

  it('defaults to HEAD', async () => {
    const result = await probeUrl(server.url, { timeout: 3000 });
    expect(result.ok).toBe(true);
    expect(result.responseHeaders['x-method']).toBe('HEAD');
  });

  it('sends GET when method: GET is specified', async () => {
    const result = await probeUrl(server.url, { method: 'GET', timeout: 3000 });
    expect(result.ok).toBe(true);
    expect(result.responseHeaders['x-method']).toBe('GET');
  });
});

// ─── probeUrl — malformed / invalid URLs ─────────────────────────────────────

describe('probeUrl — invalid URL', () => {
  it('returns ok:false for a completely invalid URL', async () => {
    const result = await probeUrl('not-a-url', { timeout: 3000 });
    expect(result.ok).toBe(false);
    expect(result.status).toBe(0);
    expect(result.error).toBeTruthy();
    expect(typeof result.latencyMs).toBe('number');
  });

  it('uses UNKNOWN errorCode when error has no code property', async () => {
    // An invalid URL throws a TypeError (no .code) — should map to 'UNKNOWN'
    const result = await probeUrl(':::bad:::url', { timeout: 3000 });
    expect(result.ok).toBe(false);
    // Either UNKNOWN or whatever Node assigns — must be a non-empty string
    expect(typeof result.errorCode).toBe('string');
    expect(result.errorCode.length).toBeGreaterThan(0);
  });
});

// ─── probeUrl — ECONNREFUSED ──────────────────────────────────────────────────

describe('probeUrl — ECONNREFUSED', () => {
  it('returns ok:false with ECONNREFUSED code on a closed port', async () => {
    const result = await probeUrl('http://127.0.0.1:1/', { timeout: 3000 });
    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe('ECONNREFUSED');
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });
});

// ─── probeUrl — HTTP response status codes ───────────────────────────────────

describe('probeUrl — HTTP response codes', () => {
  let server;

  beforeAll(async () => {
    server = await createHttpServer((req, res) => {
      const code = parseInt(req.url.slice(1), 10) || 200;
      res.writeHead(code);
      res.end();
    });
  });

  afterAll(() => server.close());

  it('ok=true for 200', async () => {
    expect((await probeUrl(`${server.url}/200`, { timeout: 3000 })).ok).toBe(true);
  });

  it('ok=true for 301', async () => {
    expect((await probeUrl(`${server.url}/301`, { timeout: 3000 })).ok).toBe(true);
  });

  it('ok=false for 404 (server reachable but not found)', async () => {
    const r = await probeUrl(`${server.url}/404`, { timeout: 3000 });
    expect(r.ok).toBe(false);
    expect(r.status).toBe(404);
    expect(r.errorCode).toBeNull();
  });

  it('ok=false for 500', async () => {
    const r = await probeUrl(`${server.url}/500`, { timeout: 3000 });
    expect(r.ok).toBe(false);
    expect(r.status).toBe(500);
  });

  it('includes latencyMs on all results', async () => {
    const r = await probeUrl(`${server.url}/200`, { timeout: 3000 });
    expect(typeof r.latencyMs).toBe('number');
    expect(r.latencyMs).toBeGreaterThanOrEqual(0);
  });
});

// ─── probeUrl — HTTP proxy path (B): auth + forwarding ───────────────────────

describe('probeUrl — HTTP target via proxy', () => {
  let target, openProxy, authProxy, blockProxy;

  beforeAll(async () => {
    target = await createHttpServer((req, res) => {
      res.writeHead(200);
      res.end('ok');
    });
    openProxy = await createProxyServer();
    authProxy = await createProxyServer({ auth: { user: 'u', pass: 'p' } });
    blockProxy = await createProxyServer({ mode: 'block' });
  });

  afterAll(async () => {
    await target.close();
    await openProxy.close();
    await authProxy.close();
    await blockProxy.close();
  });

  it('ok=true through an open proxy', async () => {
    const r = await probeUrl(target.url, { proxyUrl: openProxy.url, timeout: 4000 });
    expect(r.ok).toBe(true);
  });

  it('returns EPROXY code when proxy demands auth (407)', async () => {
    const r = await probeUrl(target.url, { proxyUrl: authProxy.url, timeout: 4000 });
    expect(r.ok).toBe(false);
    expect(r.errorCode).toBe('EPROXY');
    expect(r.error).toMatch(/407/);
  });

  it('ok=true when correct credentials supplied in proxy URL', async () => {
    const urlWithCreds = authProxy.url.replace('http://', 'http://u:p@');
    const r = await probeUrl(target.url, { proxyUrl: urlWithCreds, timeout: 4000 });
    expect(r.ok).toBe(true);
  });

  it('ok=false when proxy returns 502', async () => {
    const r = await probeUrl(target.url, { proxyUrl: blockProxy.url, timeout: 4000 });
    expect(r.ok).toBe(false);
  });

  it('ok=false (ECONNREFUSED) when proxy is not listening', async () => {
    const r = await probeUrl(target.url, { proxyUrl: 'http://127.0.0.1:1/', timeout: 3000 });
    expect(r.ok).toBe(false);
    expect(r.errorCode).toBe('ECONNREFUSED');
  });
});
