/**
 * Test helpers for @percy/cli-doctor
 *
 * Provides lightweight in-process servers so tests work without Docker,
 * on any OS, including Linux and Windows CI runners.
 */

import http from 'http';
import net from 'net';
import os from 'os';

// ─── HTTP server ──────────────────────────────────────────────────────────────

/**
 * Start a plain HTTP server bound to 127.0.0.1 on a random free port.
 * handler(req, res) is a standard Node http handler.
 *
 * Returns { server, url, port, close }.
 *
 * @param {function} handler
 * @returns {Promise<{server: http.Server, url: string, port: number, close: function}>}
 */
export function createHttpServer(handler) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(handler);
    // Track all open sockets so we can force-close on teardown (prevents
    // server.close() from hanging when keep-alive connections are still open).
    const sockets = new Set();
    server.on('connection', s => { sockets.add(s); s.once('close', () => sockets.delete(s)); });
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      const url = `http://127.0.0.1:${port}`;
      const close = () => new Promise(r => {
        sockets.forEach(s => s.destroy());
        server.close(r);
      });
      resolve({ server, url, port, close });
    });
    server.once('error', reject);
  });
}

// ─── Proxy server ─────────────────────────────────────────────────────────────

/**
 * Start a minimal CONNECT-capable HTTP proxy server bound to 127.0.0.1.
 *
 * Modes:
 *   default        — accepts all CONNECT tunnels, pipes bidirectionally
 *   auth           — requires Basic Proxy-Authorization; returns 407 otherwise
 *   block          — always returns 502
 *
 * @param {object} [opts]
 * @param {{ user: string, pass: string }} [opts.auth]  Require Basic auth
 * @param {'block'} [opts.mode]  Return 502 for everything
 * @returns {Promise<{server: net.Server, url: string, port: number, close: function}>}
 */
export function createProxyServer(opts = {}) {
  return new Promise((resolve, reject) => {
    const sockets = new Set();
    const server = net.createServer(clientSocket => {
      sockets.add(clientSocket);
      clientSocket.once('close', () => sockets.delete(clientSocket));
      clientSocket.on('error', () => {});

      let headerBuf = '';
      const onData = chunk => {
        headerBuf += chunk.toString();
        const boundary = headerBuf.indexOf('\r\n\r\n');
        if (boundary === -1) return;

        // Stop the initial data listener — raw piping takes over after this
        clientSocket.removeListener('data', onData);

        const headers = headerBuf.slice(0, boundary);
        const firstLine = headers.split('\r\n')[0];
        const [method, target] = firstLine.split(' ');

        // ── block mode ──────────────────────────────────────────────────────
        if (opts.mode === 'block') {
          clientSocket.end('HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\n\r\n');
          return;
        }

        // ── auth check ──────────────────────────────────────────────────────
        if (opts.auth) {
          const authMatch = headers.match(/Proxy-Authorization:\s*Basic\s+(\S+)/i);
          if (!authMatch) {
            clientSocket.end(
              'HTTP/1.1 407 Proxy Authentication Required\r\n' +
              'Proxy-Authenticate: Basic realm="proxy"\r\n' +
              'Content-Length: 0\r\n\r\n'
            );
            return;
          }
          const decoded = Buffer.from(authMatch[1], 'base64').toString();
          const [user, pass] = decoded.split(':');
          if (user !== opts.auth.user || pass !== opts.auth.pass) {
            clientSocket.end(
              'HTTP/1.1 407 Proxy Authentication Required\r\nContent-Length: 0\r\n\r\n'
            );
            return;
          }
        }

        // ── CONNECT tunnel ──────────────────────────────────────────────────
        if (method === 'CONNECT') {
          const colonIdx = target.lastIndexOf(':');
          const host = target.slice(0, colonIdx);
          const port = parseInt(target.slice(colonIdx + 1), 10) || 443;

          const remote = net.connect({ host, port });
          remote.on('error', () => {
            clientSocket.end('HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\n\r\n');
          });
          remote.once('connect', () => {
            clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
            // Pipe the remainder of the buffer that arrived after the CONNECT headers
            const rest = headerBuf.slice(boundary + 4);
            if (rest.length) remote.write(rest);
            remote.pipe(clientSocket);
            clientSocket.pipe(remote);
          });
          return;
        }

        // ── Plain HTTP proxy ────────────────────────────────────────────────
        // For non-CONNECT requests just return 200 (sufficient for our tests)
        clientSocket.end('HTTP/1.1 200 OK\r\nContent-Length: 0\r\n\r\n');
      };

      clientSocket.on('data', onData);
    });

    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      const url = `http://127.0.0.1:${port}`;
      const close = () => new Promise(r => {
        sockets.forEach(s => s.destroy());
        server.close(r);
      });
      resolve({ server, url, port, close });
    });
    server.once('error', reject);
  });
}

// ─── Environment variable helpers ─────────────────────────────────────────────

/**
 * Run fn() with a set of env var overrides, then restore the originals.
 * Supports setting variables that didn't previously exist (deletes them on restore).
 *
 * @param {Record<string, string|undefined>} vars
 * @param {function} fn
 */
export async function withEnv(vars, fn) {
  // On Windows env var names are case-insensitive: HTTPS_PROXY and https_proxy
  // refer to the same underlying slot. When `vars` contains both a "set" and a
  // "delete" entry for the same case-insensitive key (e.g. HTTPS_PROXY:'x' plus
  // https_proxy:undefined), naively processing them in insertion order could let
  // the delete silently erase the assignment. Deduplicate first so that a
  // non-undefined "set" always wins over an undefined "delete" for the same key.
  let entries = Object.entries(vars);
  if (os.platform() === 'win32') {
    const seen = new Map(); // lower-case key → [key, value]
    for (const [k, v] of entries) {
      const lower = k.toLowerCase();
      const existing = seen.get(lower);
      // Keep the first entry unless the current one promotes undefined → defined.
      if (!existing || (existing[1] === undefined && v !== undefined)) {
        seen.set(lower, [k, v]);
      }
    }
    entries = [...seen.values()];
  }

  const saved = {};
  for (const [k, v] of entries) {
    saved[k] = process.env[k];
    if (v === undefined) {
      delete process.env[k];
    } else {
      process.env[k] = v;
    }
  }
  try {
    return await fn();
  } finally {
    for (const [k, original] of Object.entries(saved)) {
      if (original === undefined) {
        delete process.env[k];
      } else {
        process.env[k] = original;
      }
    }
  }
}

// ─── PAC file builder ─────────────────────────────────────────────────────────

/**
 * Build a minimal valid PAC script string.
 *
 * @param {string} returnValue  Value FindProxyForURL returns, e.g. "DIRECT" or "PROXY 127.0.0.1:3128"
 * @returns {string}
 */
export function buildPacScript(returnValue) {
  return `function FindProxyForURL(url, host) { return "${returnValue}"; }`;
}

/**
 * Start an HTTP server that serves a PAC file at /proxy.pac.
 */
export async function createPacServer(pacContent) {
  return createHttpServer((req, res) => {
    if (req.url === '/proxy.pac') {
      res.writeHead(200, { 'Content-Type': 'application/x-ns-proxy-autoconfig' });
      res.end(pacContent);
    } else {
      res.writeHead(404);
      res.end('not found');
    }
  });
}

// ─── Platform utilities ───────────────────────────────────────────────────────

/** True when running on Windows. */
export const isWindows = os.platform() === 'win32';
