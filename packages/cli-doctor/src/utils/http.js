import https from 'https';
import http from 'http';
import net from 'net';
import tls from 'tls';
import { URL } from 'url';

// Default request timeout (10 seconds)
const DEFAULT_TIMEOUT = 10000;

/**
 * Probe result object
 * @typedef {object} ProbeResult
 * @property {boolean} ok       - True if request succeeded (2xx/3xx)
 * @property {number}  status   - HTTP status code (0 if no response)
 * @property {string}  error    - Error message if request failed
 * @property {string}  errorCode - Node.js error code (e.g. CERT_HAS_EXPIRED)
 * @property {number}  latencyMs - Round-trip time in milliseconds
 */

/**
 * Make a probe HTTP/HTTPS request, resolving with a ProbeResult rather than
 * throwing so callers can inspect what went wrong.
 *
 * @param {string} targetUrl
 * @param {object} [options]
 * @param {string}  [options.proxyUrl]           - http(s)://host:port proxy
 * @param {number}  [options.timeout]            - ms before abort (default 10 000)
 * @param {boolean} [options.rejectUnauthorized] - honour SSL errors (default true)
 * @param {string}  [options.method]             - HTTP verb (default HEAD → GET fallback)
 * @returns {Promise<ProbeResult>}
 */
export async function probeUrl(targetUrl, options = {}) {
  const {
    proxyUrl,
    timeout = DEFAULT_TIMEOUT,
    rejectUnauthorized = true,
    method = 'HEAD'
  } = options;

  const start = Date.now();

  try {
    const url = new URL(targetUrl);
    let result;

    if (proxyUrl) {
      const proxy = new URL(proxyUrl);
      result = url.protocol === 'https:'
        ? await _httpsViaProxy(url, proxy, { timeout, rejectUnauthorized, method })
        : await _httpViaProxy(url, proxy, { timeout, method });
    } else {
      result = await _directRequest(url, { timeout, rejectUnauthorized, method });
    }

    result.latencyMs = Date.now() - start;
    return result;
  } catch (err) {
    return {
      ok: false,
      status: 0,
      error: err.message,
      errorCode: err.code ?? 'UNKNOWN',
      latencyMs: Date.now() - start
    };
  }
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/** Direct HTTP or HTTPS request (no proxy). */
function _directRequest(url, { timeout, rejectUnauthorized, method }) {
  return new Promise((resolve, reject) => {
    const driver = url.protocol === 'https:' ? https : http;
    const port = url.port || (url.protocol === 'https:' ? 443 : 80);

    const req = driver.request({
      hostname: url.hostname,
      port,
      path: url.pathname + url.search,
      method,
      timeout,
      rejectUnauthorized
    }, (res) => {
      res.resume(); // drain
      const status = res.statusCode;
      resolve({ ok: status >= 200 && status < 400, status, error: null, errorCode: null, responseHeaders: res.headers });
    });

    req.on('timeout', () => {
      req.destroy();
      reject(Object.assign(new Error(`Request timed out after ${timeout}ms`), { code: 'ETIMEDOUT' }));
    });
    req.on('error', reject);
    req.end();
  });
}

/** HTTPS request tunnelled through an HTTP CONNECT proxy. */
function _httpsViaProxy(target, proxy, { timeout, rejectUnauthorized, method }) {
  return new Promise((resolve, reject) => {
    const proxyPort = parseInt(proxy.port, 10) || (proxy.protocol === 'https:' ? 443 : 8080);
    const targetPort = parseInt(target.port, 10) || 443;

    // Open TCP connection to proxy
    const socket = net.connect({ host: proxy.hostname, port: proxyPort });

    const timer = setTimeout(() => {
      socket.destroy();
      reject(Object.assign(new Error(`Proxy CONNECT timed out after ${timeout}ms`), { code: 'ETIMEDOUT' }));
    }, timeout);

    socket.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });

    socket.on('connect', () => {
      // Send CONNECT request
      socket.write(
        `CONNECT ${target.hostname}:${targetPort} HTTP/1.1\r\n` +
        `Host: ${target.hostname}:${targetPort}\r\n` +
        (proxy.username ? `Proxy-Authorization: Basic ${Buffer.from(`${proxy.username}:${proxy.password}`).toString('base64')}\r\n` : '') +
        '\r\n'
      );

      let response = '';
      socket.on('data', (chunk) => {
        response += chunk.toString();
        if (!response.includes('\r\n\r\n')) return;

        const statusLine = response.split('\r\n')[0];
        const statusCode = parseInt(statusLine.split(' ')[1], 10);

        if (statusCode !== 200) {
          clearTimeout(timer);
          socket.destroy();
          return reject(
            Object.assign(new Error(`Proxy CONNECT failed: ${statusLine}`), { code: 'EPROXY' })
          );
        }

        // Tunnel established – wrap in TLS
        socket.removeAllListeners('data');
        clearTimeout(timer);

        const tlsSocket = tls.connect({
          socket,
          servername: target.hostname,
          rejectUnauthorized
        });

        tlsSocket.on('error', reject);
        tlsSocket.on('secureConnect', () => {
          const req = https.request({
            createConnection: () => tlsSocket,
            hostname: target.hostname,
            port: targetPort,
            path: target.pathname + target.search,
            method
          }, (res) => {
            res.resume();
            const s = res.statusCode;
            resolve({ ok: s >= 200 && s < 400, status: s, error: null, errorCode: null, responseHeaders: res.headers });
          });
          req.on('error', reject);
          req.end();
        });
      });
    });
  });
}

/** HTTP request sent through an HTTP proxy (no tunnelling needed). */
function _httpViaProxy(target, proxy, { timeout, method }) {
  return new Promise((resolve, reject) => {
    const proxyPort = parseInt(proxy.port, 10) || 8080;

    const req = http.request({
      hostname: proxy.hostname,
      port: proxyPort,
      path: target.href, // absolute URI for proxy
      method,
      timeout,
      headers: {
        Host: target.hostname,
        ...(proxy.username
          ? { 'Proxy-Authorization': `Basic ${Buffer.from(`${proxy.username}:${proxy.password}`).toString('base64')}` }
          : {})
      }
    }, (res) => {
      res.resume();
      const status = res.statusCode;
      resolve({ ok: status >= 200 && status < 400, status, error: null, errorCode: null, responseHeaders: res.headers });
    });

    req.on('timeout', () => {
      req.destroy();
      reject(Object.assign(new Error(`Request timed out after ${timeout}ms`), { code: 'ETIMEDOUT' }));
    });
    req.on('error', reject);
    req.end();
  });
}

// SSL-related error codes emitted by Node's TLS/crypto layer
export const SSL_ERROR_CODES = new Set([
  'CERT_HAS_EXPIRED',
  'CERT_NOT_YET_VALID',
  'CERT_REVOKED',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'ERR_TLS_CERT_ALTNAME_INVALID',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_GET_ISSUER_CERT',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY'
]);

export function isSslError(result) {
  if (!result.errorCode) return false;
  if (SSL_ERROR_CODES.has(result.errorCode)) return true;
  return result.errorCode.includes('CERT') || result.errorCode.includes('SSL');
}
