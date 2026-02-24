import http from 'http';
import https from 'https';
import net from 'net';
import { probeUrl, isSslError, SSL_ERROR_CODES } from '@percy/cli-doctor/src/utils/http.js';

// ─── Minimal local HTTP server helpers ───────────────────────────────────────

function createServer(handler) {
  const srv = http.createServer(handler);
  return new Promise(resolve => {
    srv.listen(0, '127.0.0.1', () => resolve({ srv, port: srv.address().port }));
  });
}

function stopServer(srv) {
  return new Promise(resolve => srv.close(resolve));
}

// ─── probeUrl ─────────────────────────────────────────────────────────────────

describe('probeUrl', () => {
  let server, port;

  afterEach(async () => {
    if (server) {
      await stopServer(server);
      server = null;
    }
  });

  it('returns ok:true for a 200 response', async () => {
    ({ srv: server, port } = await createServer((req, res) => {
      res.writeHead(200);
      res.end('OK');
    }));

    const result = await probeUrl(`http://127.0.0.1:${port}/`);
    expect(result.ok).toBeTrue();
    expect(result.status).toBe(200);
    expect(result.errorCode).toBeNull();
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('returns ok:true for a 301 redirect', async () => {
    ({ srv: server, port } = await createServer((req, res) => {
      res.writeHead(301, { Location: '/' });
      res.end();
    }));

    const result = await probeUrl(`http://127.0.0.1:${port}/`);
    expect(result.ok).toBeTrue();
    expect(result.status).toBe(301);
  });

  it('returns ok:false with status for 4xx responses', async () => {
    ({ srv: server, port } = await createServer((req, res) => {
      res.writeHead(403);
      res.end('Forbidden');
    }));

    const result = await probeUrl(`http://127.0.0.1:${port}/`);
    expect(result.ok).toBeFalse();
    expect(result.status).toBe(403);
    // No network errorCode — just an HTTP status
    expect(result.errorCode).toBeNull();
  });

  it('returns ECONNREFUSED when nothing listens on the port', async () => {
    // Find a port that is not in use
    const freePort = await new Promise(resolve => {
      const tmp = net.createServer();
      tmp.listen(0, '127.0.0.1', () => {
        const p = tmp.address().port;
        tmp.close(() => resolve(p));
      });
    });

    const result = await probeUrl(`http://127.0.0.1:${freePort}/`);
    expect(result.ok).toBeFalse();
    expect(result.errorCode).toBe('ECONNREFUSED');
    expect(result.status).toBe(0);
  });

  it('returns ETIMEDOUT on request timeout', async () => {
    // Server that never responds
    ({ srv: server, port } = await createServer(() => { /* hang */ }));

    const result = await probeUrl(`http://127.0.0.1:${port}/`, { timeout: 100 });
    expect(result.ok).toBeFalse();
    expect(result.errorCode).toBe('ETIMEDOUT');
  });

  it('includes responseHeaders in successful response', async () => {
    ({ srv: server, port } = await createServer((req, res) => {
      res.writeHead(200, { 'x-custom': 'test-value' });
      res.end();
    }));

    const result = await probeUrl(`http://127.0.0.1:${port}/`);
    expect(result.responseHeaders?.['x-custom']).toBe('test-value');
  });

  it('uses GET fallback (same port, same result)', async () => {
    ({ srv: server, port } = await createServer((req, res) => {
      res.writeHead(200);
      res.end();
    }));

    const result = await probeUrl(`http://127.0.0.1:${port}/`, { method: 'GET' });
    expect(result.ok).toBeTrue();
  });

  it('handles proxy option parameter without throwing', async () => {
    // Just verify no crash when proxyUrl is provided but unreachable
    const result = await probeUrl('https://percy.io', {
      proxyUrl: 'http://127.0.0.1:1',
      timeout: 500
    });
    expect(result.ok).toBeFalse();
    expect(typeof result.errorCode).toBe('string');
  });
});

// ─── isSslError ──────────────────────────────────────────────────────────────

describe('isSslError', () => {
  it('returns false when errorCode is null', () => {
    expect(isSslError({ errorCode: null })).toBeFalse();
  });

  it('returns false when errorCode is ENOTFOUND', () => {
    expect(isSslError({ errorCode: 'ENOTFOUND' })).toBeFalse();
  });

  it('returns true for CERT_HAS_EXPIRED', () => {
    expect(isSslError({ errorCode: 'CERT_HAS_EXPIRED' })).toBeTrue();
  });

  it('returns true for DEPTH_ZERO_SELF_SIGNED_CERT', () => {
    expect(isSslError({ errorCode: 'DEPTH_ZERO_SELF_SIGNED_CERT' })).toBeTrue();
  });

  it('returns true for SELF_SIGNED_CERT_IN_CHAIN', () => {
    expect(isSslError({ errorCode: 'SELF_SIGNED_CERT_IN_CHAIN' })).toBeTrue();
  });

  it('returns true for ERR_TLS_CERT_ALTNAME_INVALID', () => {
    expect(isSslError({ errorCode: 'ERR_TLS_CERT_ALTNAME_INVALID' })).toBeTrue();
  });

  it('returns true for codes containing CERT', () => {
    expect(isSslError({ errorCode: 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY' })).toBeTrue();
  });

  it('returns true for codes containing SSL', () => {
    expect(isSslError({ errorCode: 'ERR_SSL_PROTOCOL_ERROR' })).toBeTrue();
  });

  it('covers all SSL_ERROR_CODES entries', () => {
    for (const code of SSL_ERROR_CODES) {
      expect(isSslError({ errorCode: code }))
        .withContext(`Expected isSslError to be true for ${code}`)
        .toBeTrue();
    }
  });
});
