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
 * @param {string}  [options.proxyUrl]  - http(s)://host:port proxy
 * @param {number}  [options.timeout]   - ms before abort (default 10 000)
 * @param {string}  [options.method]    - HTTP verb (default HEAD)
 * @returns {Promise<ProbeResult>}
 */
export async function probeUrl(targetUrl, options = {}) {
  const {
    proxyUrl,
    timeout = DEFAULT_TIMEOUT,
    method = 'HEAD'
  } = options;

  const start = Date.now();

  try {
    const url = new URL(targetUrl);
    const proxy = proxyUrl ? new URL(proxyUrl) : null;
    const result = await makeRequest(url, proxy, { timeout, method });
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

/**
 * Unified request dispatcher.  Routes to the right transport based on whether
 * a proxy is present and whether the target URL uses HTTPS.
 *
 *  • no proxy               → direct HTTP or HTTPS
 *  • proxy + HTTPS target   → CONNECT tunnel → TLS → HTTPS request
 *  • proxy + HTTP target    → plain HTTP request with absolute-URI to proxy
 */
function makeRequest(url, proxy, { timeout, method }) {
  // ── common response resolver ──────────────────────────────────────────────
  function resolveResponse(res, resolve) {
    res.resume(); // drain body
    const status = res.statusCode;
    resolve({ ok: status >= 200 && status < 400, status, error: null, errorCode: null, responseHeaders: res.headers });
  }

  // ── common timeout error ──────────────────────────────────────────────────
  function timeoutError(label) {
    return Object.assign(new Error(`${label} timed out after ${timeout}ms`), { code: 'ETIMEDOUT' });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // (A) HTTPS via CONNECT proxy tunnel
  // ─────────────────────────────────────────────────────────────────────────
  if (proxy && url.protocol === 'https:') {
    return new Promise((resolve, reject) => {
      const proxyPort = parseInt(proxy.port, 10) || (proxy.protocol === 'https:' ? 443 : 8080);
      const targetPort = parseInt(url.port, 10) || 443;

      const socket = net.connect({ host: proxy.hostname, port: proxyPort });

      const timer = setTimeout(() => {
        socket.destroy();
        reject(timeoutError('Proxy CONNECT'));
      }, timeout);

      socket.on('error', (err) => { clearTimeout(timer); reject(err); });

      socket.on('connect', () => {
        const authHeader = proxy.username
          ? `Proxy-Authorization: Basic ${Buffer.from(`${proxy.username}:${proxy.password}`).toString('base64')}\r\n`
          : '';
        socket.write(
          `CONNECT ${url.hostname}:${targetPort} HTTP/1.1\r\n` +
          `Host: ${url.hostname}:${targetPort}\r\n` +
          authHeader +
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
            return reject(Object.assign(new Error(`Proxy CONNECT failed: ${statusLine}`), { code: 'EPROXY' }));
          }

          socket.removeAllListeners('data');
          clearTimeout(timer);

          const tlsSocket = tls.connect({ socket, servername: url.hostname });
          tlsSocket.on('error', reject);
          tlsSocket.on('secureConnect', () => {
            const req = https.request({
              createConnection: () => tlsSocket,
              hostname: url.hostname,
              port: targetPort,
              path: url.pathname + url.search,
              method
            }, (res) => resolveResponse(res, resolve));
            req.on('error', reject);
            req.end();
          });
        });
      });
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // (B) HTTP via proxy (plain absolute-URI request, no tunnelling)
  // ─────────────────────────────────────────────────────────────────────────
  if (proxy && url.protocol === 'http:') {
    return new Promise((resolve, reject) => {
      const proxyPort = parseInt(proxy.port, 10) || 8080;
      const req = http.request({
        hostname: proxy.hostname,
        port: proxyPort,
        path: url.href, // absolute URI
        method,
        timeout,
        headers: {
          Host: url.hostname,
          ...(proxy.username
            ? { 'Proxy-Authorization': `Basic ${Buffer.from(`${proxy.username}:${proxy.password}`).toString('base64')}` }
            : {})
        }
      }, (res) => resolveResponse(res, resolve));
      req.on('timeout', () => { req.destroy(); reject(timeoutError('Request')); });
      req.on('error', reject);
      req.end();
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // (C) Direct HTTP or HTTPS (no proxy)
  // ─────────────────────────────────────────────────────────────────────────
  return new Promise((resolve, reject) => {
    const driver = url.protocol === 'https:' ? https : http;
    const port = url.port || (url.protocol === 'https:' ? 443 : 80);

    const req = driver.request({
      hostname: url.hostname,
      port,
      path: url.pathname + url.search,
      method,
      timeout
    }, (res) => resolveResponse(res, resolve));

    req.on('timeout', () => { req.destroy(); reject(timeoutError('Request')); });
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
