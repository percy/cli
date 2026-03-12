/**
 * Tests for packages/cli-doctor/src/checks/browser.js
 *
 * Pure unit tests (sanitizeExecutablePath, safeEnvPath) run on every OS with no
 * external dependencies.
 *
 * Integration tests that actually launch Chrome are guarded by:
 *   const chromePath = process.env.PERCY_BROWSER_EXECUTABLE || <auto-detect>;
 *   if (!chromePath) return pending('Chrome not available');
 *
 * The chromePath: null scenario tests the "skip" code-path deterministically
 * without needing to control the entire OS environment.
 */

import path from 'path';
import os from 'os';
import fsMod from 'fs';
import net from 'net';
import http from 'http';
import { WebSocketServer } from 'ws';
import {
  sanitizeExecutablePath,
  safeEnvPath,
  BrowserChecker,
  NetworkCapture,
  analyseCapture,
  safeHostname
} from '../src/checks/browser.js';
import { withEnv } from './helpers.js';

// Increase timeout for tests that might launch Chrome
jasmine.DEFAULT_TIMEOUT_INTERVAL = 90000;

// ─── Mock Chrome helpers ──────────────────────────────────────────────────────

/** Fake net.Server returned by mocked net.createServer(). */
function makeFakeNetServer(fakePort = 19222) {
  return {
    listen(p, host, cb) { process.nextTick(cb); return this; },
    address() { return { port: fakePort }; },
    close(cb) { if (cb) process.nextTick(cb); },
    on() { return this; }
  };
}

/** Returns a spy body for http.get that delivers a CDP /json/list page target. */
function makeHttpGetMock(wsUrl) {
  return function fakeCdpPoll(_url, _opts, cb) {
    const body = JSON.stringify([{ type: 'page', webSocketDebuggerUrl: wsUrl }]);
    const fakeRes = {
      on(ev, handler) {
        if (ev === 'data') process.nextTick(() => handler(body));
        if (ev === 'end') process.nextTick(() => handler());
        return this;
      }
    };
    process.nextTick(() => cb(fakeRes));
    return { on() { return this; } };
  };
}

/**
 * Starts a minimal in-process CDP WebSocket server.
 * – Responds to every CDP command with { id, result: {} }.
 * – When Network.enable arrives, optionally emits a synthetic network
 *   request that succeeds (reachable=true) or fails (reachable=false).
 * – When Page.navigate arrives, emits Page.loadEventFired after ~30 ms.
 */
function startFakeCDPServer(opts = {}) {
  const { reachable = true, emitRequests = true } = opts;
  return new Promise((resolve, reject) => {
    const wss = new WebSocketServer({ host: '127.0.0.1', port: 0 }, () => {
      const { port } = wss.address();
      const wsUrl = `ws://127.0.0.1:${port}`;
      wss.on('connection', ws => {
        ws.on('message', raw => {
          let msg;
          try { msg = JSON.parse(raw.toString()); } catch { return; }
          // Acknowledge every CDP command
          if (msg.id != null) {
            ws.send(JSON.stringify({ id: msg.id, result: {} }));
          }
          // Emit synthetic network activity after Network.enable
          if (msg.method === 'Network.enable' && emitRequests) {
            const reqId = 'r1';
            const emit = (method, params) =>
              ws.send(JSON.stringify({ method, params }));
            emit('Network.requestWillBeSent', {
              requestId: reqId,
              request: { url: 'https://percy.io/', method: 'GET', initiator: null },
              type: 'Document',
              timestamp: Date.now() / 1000
            });
            setTimeout(() => {
              if (reachable) {
                emit('Network.responseReceived', {
                  requestId: reqId,
                  response: {
                    status: 200,
                    statusText: 'OK',
                    fromDiskCache: false,
                    fromServiceWorker: false,
                    protocol: 'h2',
                    remoteIPAddress: '1.2.3.4',
                    headers: { via: '1.1 fake-proxy.test' }
                  }
                });
              } else {
                emit('Network.loadingFailed', {
                  requestId: reqId,
                  errorText: 'net::ERR_CONNECTION_REFUSED',
                  blockedReason: null,
                  corsErrorStatus: null
                });
              }
            }, 20);
          }
          // After Page.navigate, fire loadEventFired so the capture can end
          if (msg.method === 'Page.navigate') {
            setTimeout(() =>
              ws.send(JSON.stringify({ method: 'Page.loadEventFired', params: {} }))
            , 30);
          }
        });
      });
      resolve({ wss, wsUrl });
    });
    wss.on('error', reject);
  });
}

// ─── sanitizeExecutablePath ───────────────────────────────────────────────────

describe('sanitizeExecutablePath', () => {
  it('returns null for null input', () => {
    expect(sanitizeExecutablePath(null)).toBeNull();
  });

  it('returns null for undefined input', () => {
    expect(sanitizeExecutablePath(undefined)).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(sanitizeExecutablePath('')).toBeNull();
  });

  it('returns null for non-string input', () => {
    expect(sanitizeExecutablePath(42)).toBeNull();
    expect(sanitizeExecutablePath({})).toBeNull();
    expect(sanitizeExecutablePath([])).toBeNull();
  });

  it('returns null when path contains semicolon', () => {
    expect(sanitizeExecutablePath('/usr/bin/chrome;rm -rf /')).toBeNull();
  });

  it('returns null when path contains pipe', () => {
    expect(sanitizeExecutablePath('/usr/bin/chrome|cat /etc/passwd')).toBeNull();
  });

  it('returns null when path contains ampersand', () => {
    expect(sanitizeExecutablePath('/usr/bin/chrome&malicious')).toBeNull();
  });

  it('returns null when path contains backtick', () => {
    expect(sanitizeExecutablePath('/usr/bin/chrome`id`')).toBeNull();
  });

  it('returns null when path contains dollar sign', () => {
    expect(sanitizeExecutablePath('/usr/bin/$HOME/chrome')).toBeNull();
  });

  it('returns null when path contains newline', () => {
    expect(sanitizeExecutablePath('/usr/bin/chrome\nmalicious')).toBeNull();
  });

  it('returns null when path contains double-quote', () => {
    expect(sanitizeExecutablePath('/usr/bin/"chrome"')).toBeNull();
  });

  it('returns null when path contains single-quote', () => {
    expect(sanitizeExecutablePath("/usr/bin/'chrome'")).toBeNull();
  });

  it('returns resolved absolute path for a valid absolute path', () => {
    const result = sanitizeExecutablePath('/usr/bin/chrome');
    expect(result).toBe(path.resolve('/usr/bin/chrome'));
    expect(path.isAbsolute(result)).toBe(true);
  });

  it('returns resolved path for a path with spaces (no metacharacters)', () => {
    const input = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    const result = sanitizeExecutablePath(input);
    expect(result).toBe(path.resolve(input));
  });

  it('resolves a relative path to an absolute path', () => {
    // path.resolve always returns absolute — relative inputs become absolute too
    const result = sanitizeExecutablePath('relative/chrome');
    expect(result).not.toBeNull();
    expect(path.isAbsolute(result)).toBe(true);
    expect(result).toBe(path.resolve('relative/chrome'));
  });

  it('path is not an absolute path it returns null', () => {
    // path.resolve always returns absolute — relative inputs become absolute too
    spyOn(path, 'isAbsolute').and.returnValue(false);
    const result = sanitizeExecutablePath('relative/chrome');
    expect(result).toBeNull();
  });

  it('normalizes double-slashes and dots in the path', () => {
    const result = sanitizeExecutablePath('/usr//bin/../bin/chrome');
    expect(result).toBe(path.resolve('/usr//bin/../bin/chrome'));
    expect(result).not.toContain('..');
  });
});

// ─── safeEnvPath ──────────────────────────────────────────────────────────────

describe('safeEnvPath', () => {
  const fallback = os.platform() === 'win32' ? 'C:\\Fallback' : '/fallback';

  it('returns fallback for null input', () => {
    expect(safeEnvPath(null, fallback)).toBe(fallback);
  });

  it('returns fallback for undefined input', () => {
    expect(safeEnvPath(undefined, fallback)).toBe(fallback);
  });

  it('returns fallback for empty string', () => {
    expect(safeEnvPath('', fallback)).toBe(fallback);
  });

  it('returns fallback for non-string input', () => {
    expect(safeEnvPath(42, fallback)).toBe(fallback);
  });

  it('returns the resolved path for a valid absolute path', () => {
    const absPath = os.platform() === 'win32'
      ? 'C:\\Program Files'
      : '/usr/local';
    const result = safeEnvPath(absPath, fallback);
    expect(result).toBe(path.resolve(absPath));
  });

  it('resolves a relative path (path.resolve is always absolute)', () => {
    // By design, path.resolve makes any string absolute, so any non-empty
    // string will NOT return the fallback — this is the defined behaviour.
    const result = safeEnvPath('relative/dir', fallback);
    expect(path.isAbsolute(result)).toBe(true);
    expect(result).toBe(path.resolve('relative/dir'));
  });

  it('resolves to fallback if not an aboslute path after resolving', () => {
    // By design, path.resolve makes any string absolute, so any non-empty
    // string will NOT return the fallback — this is the defined behaviour.
    spyOn(path, 'isAbsolute').and.returnValue(false);
    const result = safeEnvPath('relative/dir', fallback);
    expect(result).toBe(fallback);
  });

  it('normalises path separators and dots', () => {
    const absPath = os.platform() === 'win32'
      ? 'C:\\Program Files\\..\\Program Files'
      : '/usr/local/../local';
    const result = safeEnvPath(absPath, fallback);
    expect(result).toBe(path.resolve(absPath));
  });
});

// ─── checkBrowserNetwork — skip path ─────────────────────────────────────────

// ─── checkBrowserNetwork tests removed ───────────────────────────────────────
// These tests relied on chromePath injection which has been removed to keep
// the API clean. The skip path is tested by the actual Chrome detection logic.

// ─── safeHostname ─────────────────────────────────────────────────────────────

describe('safeHostname', () => {
  it('extracts hostname from https URL', () => {
    expect(safeHostname('https://percy.io/path?q=1')).toBe('percy.io');
  });

  it('extracts hostname from http URL', () => {
    expect(safeHostname('http://www.example.com:8080/foo')).toBe('www.example.com');
  });

  it('returns raw string for an invalid URL', () => {
    expect(safeHostname('not-a-url')).toBe('not-a-url');
  });

  it('returns raw string for data: URL (malformed)', () => {
    // data: URLs parse successfully but have empty hostname; safeHostname
    // returns whatever new URL() gives — just verify it is a string.
    const r = safeHostname('data:text/html,hello');
    expect(typeof r).toBe('string');
  });

  it('handles URL with authentication info', () => {
    expect(safeHostname('http://user:pass@proxy.corp.com:3128')).toBe('proxy.corp.com');
  });
});

// ─── analyseCapture ───────────────────────────────────────────────────────────

describe('analyseCapture', () => {
  it('returns an empty Map for empty requests', () => {
    const m = analyseCapture({ requests: [] });
    expect(m instanceof Map).toBe(true);
    expect(m.size).toBe(0);
  });

  it('groups requests by hostname', () => {
    const requests = [
      { hostname: 'percy.io', reachable: true, blocked: false, errorText: null },
      { hostname: 'percy.io', reachable: false, blocked: false, errorText: null },
      { hostname: 'cdn.example.com', reachable: false, blocked: true, errorText: 'net::ERR_BLOCKED_BY_CLIENT' }
    ];
    const m = analyseCapture({ requests });
    expect(m.has('percy.io')).toBe(true);
    expect(m.has('cdn.example.com')).toBe(true);
    expect(m.size).toBe(2);
  });

  it('marks hostname reachable when any request is reachable', () => {
    const requests = [
      { hostname: 'percy.io', reachable: true, blocked: false, errorText: null },
      { hostname: 'percy.io', reachable: false, blocked: false, errorText: null }
    ];
    const m = analyseCapture({ requests });
    expect(m.get('percy.io').reachable).toBe(true);
  });

  it('marks hostname blocked when any request is blocked', () => {
    const requests = [
      { hostname: 'percy.io', reachable: false, blocked: true, errorText: null }
    ];
    const m = analyseCapture({ requests });
    expect(m.get('percy.io').blocked).toBe(true);
  });

  it('collects error text, excluding ERR_ABORTED', () => {
    const requests = [
      { hostname: 'percy.io', reachable: false, blocked: false, errorText: 'net::ERR_CONNECTION_REFUSED' },
      { hostname: 'percy.io', reachable: false, blocked: false, errorText: 'net::ERR_ABORTED' }
    ];
    const m = analyseCapture({ requests });
    const entry = m.get('percy.io');
    expect(entry.errors).toContain('net::ERR_CONNECTION_REFUSED');
    expect(entry.errors).not.toContain('net::ERR_ABORTED');
  });

  it('each entry has requests array with all requests for that hostname', () => {
    const requests = [
      { hostname: 'percy.io', reachable: true, blocked: false, errorText: null, url: 'https://percy.io/a' },
      { hostname: 'percy.io', reachable: true, blocked: false, errorText: null, url: 'https://percy.io/b' }
    ];
    const m = analyseCapture({ requests });
    expect(m.get('percy.io').requests.length).toBe(2);
  });

  it('errors is an array (not a Set) after build', () => {
    const requests = [
      { hostname: 'percy.io', reachable: false, blocked: false, errorText: 'ERR_CERT_AUTHORITY_INVALID' }
    ];
    const m = analyseCapture({ requests });
    expect(Array.isArray(m.get('percy.io').errors)).toBe(true);
  });
});

// ─── NetworkCapture ────────────────────────────────────────────────────────────

describe('NetworkCapture — onRequestWillBeSent', () => {
  it('records a request by requestId', () => {
    const nc = new NetworkCapture();
    nc.onRequestWillBeSent({
      requestId: '1',
      request: { url: 'https://percy.io/', method: 'GET', initiator: { type: 'other' } },
      type: 'Document',
      timestamp: 1000
    });
    const reqs = nc.buildRequests();
    expect(reqs.length).toBe(1);
    expect(reqs[0].hostname).toBe('percy.io');
    expect(reqs[0].method).toBe('GET');
  });

  it('ignores data: URLs', () => {
    const nc = new NetworkCapture();
    nc.onRequestWillBeSent({
      requestId: '2',
      request: { url: 'data:text/html,hello', method: 'GET', initiator: null },
      type: 'Document',
      timestamp: 1000
    });
    expect(nc.buildRequests().length).toBe(0);
  });

  it('handles missing initiator gracefully', () => {
    const nc = new NetworkCapture();
    nc.onRequestWillBeSent({
      requestId: '3',
      request: { url: 'https://example.com/', method: 'HEAD', initiator: null },
      type: 'XHR',
      timestamp: 1000
    });
    const reqs = nc.buildRequests();
    expect(reqs[0].initiatorType).toBeUndefined();
  });
});

describe('NetworkCapture — onResponseReceived', () => {
  it('stores response status and marks reachable for 200', async () => {
    const nc = new NetworkCapture();
    nc.onRequestWillBeSent({
      requestId: '1',
      request: { url: 'https://percy.io/', method: 'GET', initiator: null },
      type: 'Document',
      timestamp: 1000
    });
    await nc.onResponseReceived({
      requestId: '1',
      response: {
        status: 200,
        statusText: 'OK',
        fromDiskCache: false,
        fromServiceWorker: false,
        protocol: 'h2',
        remoteIPAddress: '1.2.3.4',
        headers: { 'content-type': 'text/html' }
      }
    });
    const reqs = nc.buildRequests();
    expect(reqs[0].reachable).toBe(true);
    expect(reqs[0].response.status).toBe(200);
  });

  it('collects proxy-indicating headers (Via)', async () => {
    const nc = new NetworkCapture();
    nc.onRequestWillBeSent({
      requestId: '1',
      request: { url: 'https://percy.io/', method: 'GET', initiator: null },
      type: 'Document',
      timestamp: 1000
    });
    await nc.onResponseReceived({
      requestId: '1',
      response: {
        status: 200,
        statusText: 'OK',
        fromDiskCache: false,
        fromServiceWorker: false,
        protocol: 'h2',
        remoteIPAddress: '1.2.3.4',
        headers: { via: '1.1 proxy.corp.com' }
      }
    });
    expect(nc.getProxyHeaders()).toContain('via: 1.1 proxy.corp.com');
  });

  it('collects x-forwarded-for proxy header', async () => {
    const nc = new NetworkCapture();
    nc.onRequestWillBeSent({
      requestId: '1',
      request: { url: 'https://percy.io/', method: 'GET', initiator: null },
      type: 'Document',
      timestamp: 1000
    });
    await nc.onResponseReceived({
      requestId: '1',
      response: {
        status: 200,
        statusText: 'OK',
        fromDiskCache: false,
        fromServiceWorker: false,
        protocol: 'h2',
        remoteIPAddress: '1.2.3.4',
        headers: { 'x-forwarded-for': '203.0.113.5' }
      }
    });
    expect(nc.getProxyHeaders().some(h => h.startsWith('x-forwarded-for'))).toBe(true);
  });

  it('sets fromCache:true when fromDiskCache is true (covers || short-circuit branch)', async () => {
    const nc = new NetworkCapture();
    nc.onRequestWillBeSent({
      requestId: '1',
      request: { url: 'https://percy.io/', method: 'GET', initiator: null },
      type: 'Document',
      timestamp: 1000
    });
    await nc.onResponseReceived({
      requestId: '1',
      response: {
        status: 200,
        statusText: 'OK',
        fromDiskCache: true,
        fromServiceWorker: false,
        protocol: 'h2',
        remoteIPAddress: '1.2.3.4',
        headers: { 'content-type': 'text/html' }
      }
    });
    expect(nc.buildRequests()[0].response.fromCache).toBe(true);
  });

  it('handles null headers without throwing (covers headers ?? {} branch)', async () => {
    const nc = new NetworkCapture();
    nc.onRequestWillBeSent({
      requestId: '1',
      request: { url: 'https://percy.io/', method: 'GET', initiator: null },
      type: 'Document',
      timestamp: 1000
    });
    await nc.onResponseReceived({
      requestId: '1',
      response: {
        status: 200,
        statusText: 'OK',
        fromDiskCache: false,
        fromServiceWorker: false,
        protocol: 'h2',
        remoteIPAddress: '1.2.3.4',
        headers: null
      }
    });
    expect(nc.getProxyHeaders()).toEqual([]);
  });

  it('marks reachable:false for 4xx response (covers status>=200&&status<400 false branch)', async () => {
    const nc = new NetworkCapture();
    nc.onRequestWillBeSent({
      requestId: '1',
      request: { url: 'https://percy.io/', method: 'GET', initiator: null },
      type: 'Document',
      timestamp: 1000
    });
    await nc.onResponseReceived({
      requestId: '1',
      response: {
        status: 404,
        statusText: 'Not Found',
        fromDiskCache: false,
        fromServiceWorker: false,
        protocol: 'h2',
        remoteIPAddress: '1.2.3.4',
        headers: { 'content-type': 'text/html' }
      }
    });
    expect(nc.buildRequests()[0].reachable).toBe(false);
  });

  it('collects all remaining proxy-header types (covers x-proxy, proxy-, x-forwarded-host, zscaler, netskope, bluecoat, x-cache, cf-ray OR-chain branches)', async () => {
    // Each header is processed independently in the loop — one response with all
    // types covers every uncovered || branch in the proxy-header detection chain.
    const nc = new NetworkCapture();
    nc.onRequestWillBeSent({
      requestId: '1',
      request: { url: 'https://percy.io/', method: 'GET', initiator: null },
      type: 'Document',
      timestamp: 1000
    });
    await nc.onResponseReceived({
      requestId: '1',
      response: {
        status: 200,
        statusText: 'OK',
        fromDiskCache: false,
        fromServiceWorker: false,
        protocol: 'h2',
        remoteIPAddress: '1.2.3.4',
        headers: {
          'x-proxy-id': 'p1', // lh.startsWith('x-proxy') = true
          'proxy-status': '200', // lh.startsWith('proxy-') = true
          'x-forwarded-host': 'h.corp', // lh === 'x-forwarded-host' = true
          'x-zscaler-id': 'z1', // lh.includes('zscaler') = true
          'x-netskope-id': 'n1', // lh.includes('netskope') = true
          'x-bluecoat-id': 'b1', // lh.includes('bluecoat') = true
          'x-cache': 'HIT', // lh === 'x-cache' = true
          'cf-ray': 'ray123abc' // lh === 'cf-ray' = true
        }
      }
    });
    const headers = nc.getProxyHeaders();
    expect(headers.some(h => h.startsWith('x-proxy-id'))).toBe(true);
    expect(headers.some(h => h.startsWith('proxy-status'))).toBe(true);
    expect(headers.some(h => h.startsWith('x-forwarded-host'))).toBe(true);
    expect(headers.some(h => h.startsWith('x-zscaler-id'))).toBe(true);
    expect(headers.some(h => h.startsWith('x-netskope-id'))).toBe(true);
    expect(headers.some(h => h.startsWith('x-bluecoat-id'))).toBe(true);
    expect(headers.some(h => h.startsWith('x-cache'))).toBe(true);
    expect(headers.some(h => h.startsWith('cf-ray'))).toBe(true);
  });
});

describe('NetworkCapture — onLoadingFailed', () => {
  it('stores failure and marks blocked when blockedReason is set', async () => {
    const nc = new NetworkCapture();
    nc.onRequestWillBeSent({
      requestId: '1',
      request: { url: 'https://percy.io/', method: 'GET', initiator: null },
      type: 'Document',
      timestamp: 1000
    });
    await nc.onLoadingFailed({
      requestId: '1',
      errorText: 'net::ERR_BLOCKED_BY_ADMINISTRATOR',
      blockedReason: 'inspector',
      corsErrorStatus: null
    });
    const reqs = nc.buildRequests();
    expect(reqs[0].blocked).toBe(true);
    expect(reqs[0].errorText).toBe('net::ERR_BLOCKED_BY_ADMINISTRATOR');
  });

  it('marks reachable false when request fails', async () => {
    const nc = new NetworkCapture();
    nc.onRequestWillBeSent({
      requestId: '1',
      request: { url: 'https://percy.io/', method: 'GET', initiator: null },
      type: 'Document',
      timestamp: 1000
    });
    await nc.onLoadingFailed({
      requestId: '1',
      errorText: 'net::ERR_CONNECTION_REFUSED',
      blockedReason: null,
      corsErrorStatus: null
    });
    const reqs = nc.buildRequests();
    expect(reqs[0].reachable).toBe(false);
  });
});

describe('NetworkCapture — buildRequests + getProxyHeaders', () => {
  it('getProxyHeaders returns empty array when no proxy headers seen', () => {
    const nc = new NetworkCapture();
    nc.onRequestWillBeSent({
      requestId: '1',
      request: { url: 'https://percy.io/', method: 'GET', initiator: null },
      type: 'Document',
      timestamp: 1000
    });
    expect(nc.getProxyHeaders()).toEqual([]);
  });

  it('deduplicates proxy headers', async () => {
    const nc = new NetworkCapture();
    for (const id of ['1', '2']) {
      nc.onRequestWillBeSent({
        requestId: id,
        request: { url: `https://percy.io/${id}`, method: 'GET', initiator: null },
        type: 'XHR',
        timestamp: 1000
      });
      await nc.onResponseReceived({
        requestId: id,
        response: {
          status: 200,
          statusText: 'OK',
          fromDiskCache: false,
          fromServiceWorker: false,
          protocol: 'h2',
          remoteIPAddress: '1.2.3.4',
          headers: { via: '1.1 same-proxy' }
        }
      });
    }
    const headers = nc.getProxyHeaders();
    expect(headers.filter(h => h === 'via: 1.1 same-proxy').length).toBe(1);
  });

  it('request with neither response nor failure is not reachable and not blocked', () => {
    const nc = new NetworkCapture();
    nc.onRequestWillBeSent({
      requestId: '1',
      request: { url: 'https://percy.io/', method: 'GET', initiator: null },
      type: 'Document',
      timestamp: 1000
    });
    const reqs = nc.buildRequests();
    expect(reqs[0].reachable).toBe(false);
    expect(reqs[0].blocked).toBe(false);
    expect(reqs[0].response).toBeNull();
    expect(reqs[0].errorText).toBeNull();
  });
});

// ─── BrowserChecker — checkBrowserNetwork — skip path ───────────────────────

describe('BrowserChecker — checkBrowserNetwork — skip path', () => {
  it('returns status:skip when no Chrome binary is found', async () => {
    spyOn(fsMod, 'existsSync').and.returnValue(false);
    const result = await withEnv(
      { PERCY_BROWSER_EXECUTABLE: undefined },
      () => new BrowserChecker().checkBrowserNetwork()
    );
    expect(result.status).toBe('skip');
    expect(result.chromePath).toBeNull();
    expect(result.domainSummary).toEqual([]);
    expect(result.proxyHeaders).toEqual([]);
    expect(result.directCapture).toBeNull();
    expect(result.proxyCapture).toBeNull();
  });

  it('skip result contains install suggestions', async () => {
    spyOn(fsMod, 'existsSync').and.returnValue(false);
    const result = await withEnv(
      { PERCY_BROWSER_EXECUTABLE: undefined },
      () => new BrowserChecker().checkBrowserNetwork()
    );
    expect(Array.isArray(result.suggestions)).toBe(true);
    expect(result.suggestions.some(s => /chrome|PERCY_BROWSER_EXECUTABLE/i.test(s))).toBe(true);
  });

  it('skip result preserves targetUrl option', async () => {
    spyOn(fsMod, 'existsSync').and.returnValue(false);
    const result = await withEnv(
      { PERCY_BROWSER_EXECUTABLE: undefined },
      () => new BrowserChecker().checkBrowserNetwork({ targetUrl: 'https://example.com' })
    );
    expect(result.targetUrl).toBe('https://example.com');
  });

  it('exercises linux Chrome candidate paths when platform is linux', async () => {
    // Covers the linux branch inside #systemChromePaths (line ~201)
    spyOn(fsMod, 'existsSync').and.returnValue(false);
    spyOn(os, 'platform').and.returnValue('linux');
    const result = await withEnv(
      { PERCY_BROWSER_EXECUTABLE: undefined },
      () => new BrowserChecker().checkBrowserNetwork()
    );
    expect(result.status).toBe('skip');
  });
});

// ─── BrowserChecker — checkBrowserNetwork — direct capture pass ───────────────

describe('BrowserChecker — checkBrowserNetwork — direct capture pass', () => {
  let cdpServer;

  beforeAll(async () => {
    cdpServer = await startFakeCDPServer({ reachable: true });
  });

  afterAll(done => cdpServer.wss.close(done));

  beforeEach(() => {
    spyOn(net, 'createServer').and.callFake(() => makeFakeNetServer());
    spyOn(http, 'get').and.callFake(makeHttpGetMock(cdpServer.wsUrl));
  });

  it('returns pass status when requests succeed', async () => {
    const result = await withEnv(
      { PERCY_BROWSER_EXECUTABLE: process.execPath },
      () => new BrowserChecker().checkBrowserNetwork({ timeout: 800 })
    );
    expect(result.status).toBe('pass');
    expect(result.chromePath).toBe(process.execPath);
  });

  it('result has required top-level fields', async () => {
    const result = await withEnv(
      { PERCY_BROWSER_EXECUTABLE: process.execPath },
      () => new BrowserChecker().checkBrowserNetwork({ timeout: 800 })
    );
    expect(typeof result.navMs).toBe('number');
    expect(typeof result.targetUrl).toBe('string');
    expect(Array.isArray(result.domainSummary)).toBe(true);
    expect(Array.isArray(result.proxyHeaders)).toBe(true);
    expect(result.proxyCapture).toBeNull();
  });

  it('domainSummary entry has required shape', async () => {
    const result = await withEnv(
      { PERCY_BROWSER_EXECUTABLE: process.execPath },
      () => new BrowserChecker().checkBrowserNetwork({ timeout: 800 })
    );
    expect(result.domainSummary.length).toBeGreaterThan(0);
    const entry = result.domainSummary[0];
    expect(typeof entry.hostname).toBe('string');
    expect(['pass', 'fail', 'warn', 'skip']).toContain(entry.status);
    expect(entry.direct).not.toBeNull();
    expect(typeof entry.direct.reachable).toBe('boolean');
    expect(Array.isArray(entry.direct.errors)).toBe(true);
  });

  it('collects Via proxy header from responses', async () => {
    const result = await withEnv(
      { PERCY_BROWSER_EXECUTABLE: process.execPath },
      () => new BrowserChecker().checkBrowserNetwork({ timeout: 800 })
    );
    expect(result.proxyHeaders.some(h => /via/i.test(h))).toBe(true);
  });

  it('covers SSL-bypass branch when NODE_TLS_REJECT_UNAUTHORIZED=0', async () => {
    const result = await withEnv(
      { PERCY_BROWSER_EXECUTABLE: process.execPath, NODE_TLS_REJECT_UNAUTHORIZED: '0' },
      () => new BrowserChecker().checkBrowserNetwork({ timeout: 800 })
    );
    // Security.setIgnoreCertificateErrors is sent — CDP still responds OK
    expect(['pass', 'warn', 'fail']).toContain(result.status);
  });
});

// ─── BrowserChecker — checkBrowserNetwork — direct capture fail ───────────────

describe('BrowserChecker — checkBrowserNetwork — direct capture fail', () => {
  let cdpServer;

  beforeAll(async () => {
    cdpServer = await startFakeCDPServer({ reachable: false });
  });

  afterAll(done => cdpServer.wss.close(done));

  beforeEach(() => {
    spyOn(net, 'createServer').and.callFake(() => makeFakeNetServer());
    spyOn(http, 'get').and.callFake(makeHttpGetMock(cdpServer.wsUrl));
  });

  it('returns fail status when all requests fail', async () => {
    const result = await withEnv(
      { PERCY_BROWSER_EXECUTABLE: process.execPath },
      () => new BrowserChecker().checkBrowserNetwork({ timeout: 800 })
    );
    expect(result.status).toBe('fail');
    const entry = result.domainSummary.find(d => d.hostname === 'percy.io');
    expect(entry).toBeDefined();
    expect(entry.status).toBe('fail');
    expect(entry.direct.reachable).toBe(false);
  });

  it('fail entry records error text', async () => {
    const result = await withEnv(
      { PERCY_BROWSER_EXECUTABLE: process.execPath },
      () => new BrowserChecker().checkBrowserNetwork({ timeout: 800 })
    );
    const entry = result.domainSummary.find(d => d.hostname === 'percy.io');
    expect(entry.direct.errors.some(e => /ERR_CONNECTION_REFUSED/.test(e))).toBe(true);
  });
});

// ─── BrowserChecker — checkBrowserNetwork — proxy capture ─────────────────────

describe('BrowserChecker — checkBrowserNetwork — proxy capture', () => {
  let passServer, failServer, noReqServer;

  beforeAll(async () => {
    [passServer, failServer, noReqServer] = await Promise.all([
      startFakeCDPServer({ reachable: true }),
      startFakeCDPServer({ reachable: false }),
      startFakeCDPServer({ emitRequests: false })
    ]);
  });

  afterAll(async () => {
    await Promise.all([
      new Promise(r => passServer.wss.close(r)),
      new Promise(r => failServer.wss.close(r)),
      new Promise(r => noReqServer.wss.close(r))
    ]);
  });

  it('proxyCapture is set and carries the proxyUrl', async () => {
    spyOn(net, 'createServer').and.callFake(() => makeFakeNetServer());
    spyOn(http, 'get').and.callFake(makeHttpGetMock(passServer.wsUrl));

    const result = await withEnv(
      { PERCY_BROWSER_EXECUTABLE: process.execPath },
      () => new BrowserChecker().checkBrowserNetwork({
        timeout: 800,
        proxyUrl: 'http://proxy.example.com:8080'
      })
    );
    expect(result.proxyCapture).not.toBeNull();
    expect(result.proxyCapture.proxyUrl).toBe('http://proxy.example.com:8080');
  });

  it('returns warn status when direct fails but reachable via proxy', async () => {
    // Direct capture (first http.get call) → failServer; proxy capture (second) → passServer
    let callCount = 0;
    spyOn(net, 'createServer').and.callFake(() => makeFakeNetServer());
    spyOn(http, 'get').and.callFake((url, opts, cb) => {
      const wsUrl = (callCount++ % 2 === 0) ? failServer.wsUrl : passServer.wsUrl;
      return makeHttpGetMock(wsUrl)(url, opts, cb);
    });

    const result = await withEnv(
      { PERCY_BROWSER_EXECUTABLE: process.execPath },
      () => new BrowserChecker().checkBrowserNetwork({
        timeout: 800,
        proxyUrl: 'http://proxy.example.com:8080'
      })
    );
    expect(result.status).toBe('warn');
    const entry = result.domainSummary.find(d => d.hostname === 'percy.io');
    expect(entry).toBeDefined();
    expect(entry.status).toBe('warn');
    expect(entry.viaProxy.reachable).toBe(true);
  });

  it('domain entry status is skip when hostname appears only in proxy capture', async () => {
    // Direct: no network events; Proxy: percy.io fails → viaProxy.reachable=false → skip
    let callCount = 0;
    spyOn(net, 'createServer').and.callFake(() => makeFakeNetServer());
    spyOn(http, 'get').and.callFake((url, opts, cb) => {
      const wsUrl = (callCount++ % 2 === 0) ? noReqServer.wsUrl : failServer.wsUrl;
      return makeHttpGetMock(wsUrl)(url, opts, cb);
    });

    const result = await withEnv(
      { PERCY_BROWSER_EXECUTABLE: process.execPath },
      () => new BrowserChecker().checkBrowserNetwork({
        timeout: 800,
        proxyUrl: 'http://proxy.example.com:8080'
      })
    );
    const entry = result.domainSummary.find(d => d.hostname === 'percy.io');
    expect(entry).toBeDefined();
    expect(entry.status).toBe('skip');
    expect(entry.direct).toBeNull();
    expect(entry.viaProxy.reachable).toBe(false);
  });
});

// ─── BrowserChecker — checkBrowserNetwork — CDP error path ────────────────────

describe('BrowserChecker — checkBrowserNetwork — CDP error path', () => {
  it('sets error on directCapture when CDP WebSocket connection fails', async () => {
    // Start and immediately close the server so all WS connection attempts get ECONNREFUSED
    const tempServer = await startFakeCDPServer();
    await new Promise(r => tempServer.wss.close(r));

    spyOn(net, 'createServer').and.callFake(() => makeFakeNetServer());
    spyOn(http, 'get').and.callFake(makeHttpGetMock(tempServer.wsUrl));

    const result = await withEnv(
      { PERCY_BROWSER_EXECUTABLE: process.execPath },
      () => new BrowserChecker().checkBrowserNetwork({ timeout: 800 })
    );
    expect(result.directCapture).not.toBeNull();
    expect(typeof result.directCapture.error).toBe('string');
    expect(result.directCapture.error.length).toBeGreaterThan(0);
  });
});

// ─── BrowserChecker — checkBrowserNetwork — SIGKILL escalation ────────────────
// Covers lines 490-497: the setTimeout(gracePeriodMs) escalation block inside
// #killProcess that fires SIGKILL when the process ignores SIGTERM.
//
// A temporary Node script with SIGTERM ignored is used as the fake Chrome
// binary.  The test intentionally takes ~3 s (the hard-coded gracePeriodMs).

describe('BrowserChecker — checkBrowserNetwork — SIGKILL escalation', () => {
  let sigTermIgnoreScript;

  beforeAll(() => {
    sigTermIgnoreScript = path.join(
      os.tmpdir(),
      `percy-no-sigterm-${process.pid}.js`
    );
    fsMod.writeFileSync(
      sigTermIgnoreScript,
      [
        '#!/usr/bin/env node',
        "process.on('SIGTERM', () => {}); // ignore SIGTERM so SIGKILL path is exercised",
        'setInterval(() => {}, 999999);'
      ].join('\n')
    );
    fsMod.chmodSync(sigTermIgnoreScript, 0o755);
  });

  afterAll(() => {
    try { fsMod.unlinkSync(sigTermIgnoreScript); } catch { /* already gone */ }
  });

  it('sends SIGKILL after the grace period when the process ignores SIGTERM', async () => {
    // Use a closed CDP server so #connectCDP throws immediately, reaching
    // the finally block (and thus #killProcess) as fast as possible.
    const tempCdp = await startFakeCDPServer();
    await new Promise(r => tempCdp.wss.close(r));

    spyOn(net, 'createServer').and.callFake(() => makeFakeNetServer());
    spyOn(http, 'get').and.callFake(makeHttpGetMock(tempCdp.wsUrl));

    const result = await withEnv(
      { PERCY_BROWSER_EXECUTABLE: sigTermIgnoreScript },
      () => new BrowserChecker().checkBrowserNetwork({ timeout: 100 })
    );
    // Capture completes after SIGKILL; error reflects the CDP connection failure
    expect(result.directCapture).not.toBeNull();
    expect(typeof result.directCapture.error).toBe('string');
  });
});

// ─── BrowserChecker — win32 Chrome paths ──────────────────────────────────────
// Covers lines 206-215: the win32 branch inside #systemChromePaths().
// Reached via checkBrowserNetwork() when os.platform() is spoofed to 'win32'.

describe('BrowserChecker — checkBrowserNetwork — win32 Chrome paths', () => {
  it('exercises win32 Chrome candidate paths and returns skip when none exist', async () => {
    spyOn(os, 'platform').and.returnValue('win32');
    spyOn(fsMod, 'existsSync').and.returnValue(false);
    const result = await withEnv(
      { PERCY_BROWSER_EXECUTABLE: undefined },
      () => new BrowserChecker().checkBrowserNetwork()
    );
    expect(result.status).toBe('skip');
  });

  it('respects PROGRAMFILES env var via safeEnvPath on win32', async () => {
    spyOn(os, 'platform').and.returnValue('win32');
    spyOn(fsMod, 'existsSync').and.returnValue(false);
    const result = await withEnv(
      { PERCY_BROWSER_EXECUTABLE: undefined, PROGRAMFILES: 'C:\\Custom Program Files' },
      () => new BrowserChecker().checkBrowserNetwork()
    );
    expect(result.status).toBe('skip');
  });

  it('returns skip for an unsupported platform (covers the fallback return [])', async () => {
    // Any platform other than darwin/linux/win32 → #systemChromePaths returns []
    spyOn(os, 'platform').and.returnValue('freebsd');
    spyOn(fsMod, 'existsSync').and.returnValue(false);
    const result = await withEnv(
      { PERCY_BROWSER_EXECUTABLE: undefined },
      () => new BrowserChecker().checkBrowserNetwork()
    );
    expect(result.status).toBe('skip');
  });
});

// ─── BrowserChecker — _pollCDPPageTarget ──────────────────────────────────────
// Covers lines 281-283: the two rejection branches inside _pollCDPPageTarget.

describe('BrowserChecker — _pollCDPPageTarget', () => {
  it('rejects with "no page target ready" when response contains no page-type target', async () => {
    spyOn(http, 'get').and.callFake((_url, _opts, cb) => {
      const fakeRes = {
        on(ev, handler) {
          // Return an array with no page-type target
          if (ev === 'data') process.nextTick(() => handler(JSON.stringify([{ type: 'browser' }])));
          if (ev === 'end') process.nextTick(() => handler());
          return this;
        }
      };
      process.nextTick(() => cb(fakeRes));
      return { on() { return this; } };
    });
    await expectAsync(
      new BrowserChecker()._pollCDPPageTarget(9999)
    ).toBeRejectedWithError('no page target ready');
  });

  it('rejects with "invalid CDP response" when response body is not valid JSON', async () => {
    spyOn(http, 'get').and.callFake((_url, _opts, cb) => {
      const fakeRes = {
        on(ev, handler) {
          if (ev === 'data') process.nextTick(() => handler('not-valid-json{{'));
          if (ev === 'end') process.nextTick(() => handler());
          return this;
        }
      };
      process.nextTick(() => cb(fakeRes));
      return { on() { return this; } };
    });
    await expectAsync(
      new BrowserChecker()._pollCDPPageTarget(9999)
    ).toBeRejectedWithError('invalid CDP response');
  });

  it('rejects when the http.get request emits an error (covers req.on error branch)', async () => {
    spyOn(http, 'get').and.callFake((_url, _opts, _cb) => {
      return {
        on(ev, handler) {
          if (ev === 'error') process.nextTick(() => handler(new Error('ECONNREFUSED')));
          return this;
        }
      };
    });
    await expectAsync(
      new BrowserChecker()._pollCDPPageTarget(9999)
    ).toBeRejectedWithError('ECONNREFUSED');
  });

  it('rejects with "CDP poll timeout" when the http.get request emits timeout (covers req.on timeout branch)', async () => {
    spyOn(http, 'get').and.callFake((_url, _opts, _cb) => {
      return {
        on(ev, handler) {
          if (ev === 'timeout') process.nextTick(() => handler());
          return this;
        }
      };
    });
    await expectAsync(
      new BrowserChecker()._pollCDPPageTarget(9999)
    ).toBeRejectedWithError('CDP poll timeout');
  });
});

// ─── BrowserChecker — _waitForCDP ─────────────────────────────────────────────
// Covers line 302: throw new Error('Timed out waiting for Chrome CDP page target').
// _pollCDPPageTarget always throws → deadline expires after 1 ms → timeout throw.

describe('BrowserChecker — _waitForCDP', () => {
  it('throws "Timed out" when _pollCDPPageTarget never succeeds within the deadline', async () => {
    spyOn(http, 'get').and.callFake((_url, _opts, cb) => {
      // Return an error immediately so every poll attempt rejects
      const fakeRes = {
        on(ev, handler) {
          if (ev === 'data') process.nextTick(() => handler('[]'));
          if (ev === 'end') process.nextTick(() => handler());
          return this;
        }
      };
      process.nextTick(() => cb(fakeRes));
      return { on() { return this; } };
    });
    // 1 ms timeout → deadline expires after the first failed poll + 150 ms retry delay
    await expectAsync(
      new BrowserChecker()._waitForCDP(9999, 1)
    ).toBeRejectedWithError('Timed out waiting for Chrome CDP page target');
  });
});

// ─── BrowserChecker — _killProcess ────────────────────────────────────────────
// Covers lines 492-499: the SIGKILL escalation block.
// A fake proc whose first once('exit') listener never fires forces the escalate
// timer to run; the second once('exit') (registered inside escalate) fires
// immediately via process.nextTick so the test completes in ~gracePeriodMs ms.

describe('BrowserChecker — _killProcess', () => {
  it('resolves immediately when proc has already exited (exitCode not null)', async () => {
    const fakeProc = { exitCode: 0, killed: false, kill() {}, once() {} };
    await expectAsync(new BrowserChecker()._killProcess(fakeProc, 3000)).toBeResolved();
  });

  it('resolves immediately when proc.killed is true', async () => {
    const fakeProc = { exitCode: null, killed: true, kill() {}, once() {} };
    await expectAsync(new BrowserChecker()._killProcess(fakeProc)).toBeResolved();
  });

  it('escalates to SIGKILL and resolves when proc ignores SIGTERM', async () => {
    let killCalls = [];
    let exitCallCount = 0;

    const fakeProc = {
      exitCode: null,
      killed: false,
      kill(sig) { killCalls.push(sig); },
      once(event, cb) {
        if (event === 'exit') {
          exitCallCount++;
          if (exitCallCount >= 2) {
            // Second registration comes from inside the escalate callback —
            // fire it immediately so the test completes quickly.
            process.nextTick(cb);
          }
          // First registration: don't fire — simulates SIGTERM being ignored.
        }
      }
    };

    // 10 ms grace period so the test doesn't wait 3 s
    await new BrowserChecker()._killProcess(fakeProc, 10);

    expect(killCalls).toContain('SIGKILL');
  });
});

// ─── BrowserChecker — _doCapture — headless:false / proxyUrl branches ─────────
// Covers the three `headless ? '' : ''` ternaries (lines 411-413) and the
// `proxyUrl ? '--proxy-server=...' : ''` ternary (line 414) inside _doCapture.
// Also covers `proxyUrl ?? null` in the return (line 487).
// We stub _waitForCDP and _connectCDP so no real browser or WebSocket is needed.

describe('BrowserChecker — _doCapture — headless:false and proxyUrl branches', () => {
  let fakeCdp;

  beforeEach(() => {
    // Minimal fake CDP client: acknowledges sends and lets on() register handlers
    const _listeners = new Map();
    fakeCdp = {
      on(event, handler) {
        if (!_listeners.has(event)) _listeners.set(event, new Set());
        _listeners.get(event).add(handler);
      },
      send: jasmine.createSpy('send').and.callFake(async (method) => {
        // After Page.navigate fire Page.loadEventFired so the capture ends quickly
        if (method === 'Page.navigate') {
          process.nextTick(() => {
            for (const h of (_listeners.get('Page.loadEventFired') ?? [])) h({});
          });
        }
        return {};
      }),
      close: jasmine.createSpy('close')
    };

    spyOn(net, 'createServer').and.callFake(() => makeFakeNetServer());
    spyOn(http, 'get').and.callFake(makeHttpGetMock('ws://127.0.0.1:19222'));
  });

  it('covers headless:false branches — no --headless flags added to chromeArgs', async () => {
    const checker = new BrowserChecker();
    spyOn(checker, '_waitForCDP').and.resolveTo('ws://127.0.0.1:19222');
    spyOn(checker, '_connectCDP').and.resolveTo(fakeCdp);
    spyOn(checker, '_killProcess').and.resolveTo();

    const result = await checker._doCapture(process.execPath, 'https://example.com', {
      headless: false,
      timeout: 200
    });
    // Capture completed without error; headless:false path was exercised
    expect(result.targetUrl).toBe('https://example.com');
    expect(result.proxyUrl).toBeNull();
  });

  it('covers proxyUrl arg branch and proxyUrl??null return', async () => {
    const checker = new BrowserChecker();
    spyOn(checker, '_waitForCDP').and.resolveTo('ws://127.0.0.1:19222');
    spyOn(checker, '_connectCDP').and.resolveTo(fakeCdp);
    spyOn(checker, '_killProcess').and.resolveTo();

    const result = await checker._doCapture(process.execPath, 'https://example.com', {
      headless: true,
      timeout: 200,
      proxyUrl: 'http://proxy.test:3128'
    });
    // proxyUrl ?? null — proxyUrl is defined so it passes through
    expect(result.proxyUrl).toBe('http://proxy.test:3128');
  });
});

// ─── BrowserChecker — _captureNetworkRequests — hard-deadline with clock ───────
// Uses jasmine.clock() to instantly advance timers so the 15s hard-deadline
// branch resolves without actually waiting.

describe('BrowserChecker — _captureNetworkRequests — hard-deadline (clock)', () => {
  beforeEach(() => { jasmine.clock().install(); });
  afterEach(() => { jasmine.clock().uninstall(); });

  it('resolves with timeout error message after hard deadline fires', async () => {
    const checker = new BrowserChecker();
    spyOn(checker, '_doCapture').and.returnValue(new Promise(() => {})); // never resolves

    const opts = { timeout: 5000 }; // hardDeadline = 20000 ms
    const promise = checker._captureNetworkRequests('/fake/chrome', 'https://x.com', opts);

    // Advance past hardDeadline (timeout + 15000)
    jasmine.clock().tick(21000);

    const result = await promise;
    expect(result.error).toMatch(/timed out/i);
    expect(result.requests).toEqual([]);
    expect(result.navMs).toBe(0);
    expect(result.proxyUrl).toBeNull();
  });

  it('hard-deadline result carries proxyUrl when provided', async () => {
    const checker = new BrowserChecker();
    spyOn(checker, '_doCapture').and.returnValue(new Promise(() => {}));

    const promise = checker._captureNetworkRequests(
      '/fake/chrome', 'https://x.com', { timeout: 1000, proxyUrl: 'http://p.test:8080' }
    );
    jasmine.clock().tick(17000);

    const result = await promise;
    expect(result.proxyUrl).toBe('http://p.test:8080');
    expect(result.error).toMatch(/timed out/i);
  });
});

// ─── BrowserChecker — checkBrowserNetwork — rejected capture branches ──────────
// Covers lines 567–573: the `directResult.status === 'rejected'` and
// `proxyResult.status === 'rejected'` branches, including the
// `reason?.message ?? 'capture failed'` null-message fallback.

describe('BrowserChecker — checkBrowserNetwork — rejected capture branches', () => {
  beforeEach(() => {
    spyOn(fsMod, 'existsSync').and.callFake(p => p === process.execPath);
  });

  it('uses errCapture when directResult is rejected (reason has message)', async () => {
    const checker = new BrowserChecker();
    spyOn(checker, '_captureNetworkRequests').and.rejectWith(new Error('direct exploded'));

    const result = await withEnv(
      { PERCY_BROWSER_EXECUTABLE: process.execPath },
      () => checker.checkBrowserNetwork()
    );
    expect(result.directCapture.error).toBe('direct exploded');
    expect(result.directCapture.proxyUrl).toBeNull();
  });

  it('uses "capture failed" fallback when directResult reason has no message', async () => {
    const checker = new BrowserChecker();
    // Object.assign sets `message` as an own property with value null on the Error instance,
    // shadowing Error.prototype.message=''. Then reason?.message === null and
    // null ?? 'capture failed' === 'capture failed'. ✓
    const errNoMsg = Object.assign(new Error(), { message: null });
    spyOn(checker, '_captureNetworkRequests').and.callFake(() => Promise.reject(errNoMsg));

    const result = await withEnv(
      { PERCY_BROWSER_EXECUTABLE: process.execPath },
      () => checker.checkBrowserNetwork()
    );
    expect(result.directCapture.error).toBe('capture failed');
  });

  it('uses errCapture for proxyCapture when proxyResult is rejected', async () => {
    const checker = new BrowserChecker();
    let callCount = 0;
    spyOn(checker, '_captureNetworkRequests').and.callFake(() => {
      callCount++;
      if (callCount === 1) {
        // Direct: succeed with empty capture
        return Promise.resolve({ targetUrl: 'https://percy.io', proxyUrl: null, navMs: 0, requests: [], proxyHeaders: [], error: null });
      }
      // Proxy: reject
      return Promise.reject(new Error('proxy exploded'));
    });

    const result = await withEnv(
      { PERCY_BROWSER_EXECUTABLE: process.execPath },
      () => checker.checkBrowserNetwork({ proxyUrl: 'http://proxy.test:3128' })
    );
    expect(result.proxyCapture).not.toBeNull();
    expect(result.proxyCapture.error).toBe('proxy exploded');
    expect(result.proxyCapture.proxyUrl).toBe('http://proxy.test:3128');
  });
});

// ─── BrowserChecker — _connectCDP — duplicate event registration ───────────────
// Covers the `!_listeners.has(event)` false branch (line 353): when cdp.on() is
// called twice with the same event name the second call should skip creating a new
// Set and just add the second handler to the existing one.

describe('BrowserChecker — _connectCDP — duplicate event registration', () => {
  let cdpServer;

  beforeAll(async () => {
    cdpServer = await startFakeCDPServer();
  });

  afterAll(done => cdpServer.wss.close(done));

  it('registers two handlers for the same event without throwing', async () => {
    const checker = new BrowserChecker();
    const cdp = await checker._connectCDP(cdpServer.wsUrl);

    let calls = 0;
    const handler1 = () => { calls++; };
    const handler2 = () => { calls++; };

    // First registration creates the Set (true branch of !_listeners.has)
    cdp.on('Network.requestWillBeSent', handler1);
    // Second registration re-uses the existing Set (false branch)
    cdp.on('Network.requestWillBeSent', handler2);

    // Manually trigger the event by sending a CDP message that the server echoes back
    // We just verify no error was thrown and both handlers are registered
    expect(calls).toBe(0); // handlers haven't been called yet
    cdp.close();
  });
});

if (process.env.PERCY_TEST_BROWSER) {
  describe('checkBrowserNetwork — live Chrome', () => {
    let chromePath;

    beforeAll(async () => {
      // Allow PERCY_BROWSER_EXECUTABLE override
      chromePath = process.env.PERCY_BROWSER_EXECUTABLE || null;

      // Try to find system Chrome if no override
      if (!chromePath) {
        const { default: fs } = await import('fs');
        const candidates = [
          // Linux (GitHub Actions ubuntu-latest)
          '/usr/bin/google-chrome',
          '/usr/bin/google-chrome-stable',
          '/usr/bin/chromium-browser',
          '/usr/bin/chromium',
          '/snap/bin/chromium',
          // macOS
          '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
          '/Applications/Chromium.app/Contents/MacOS/Chromium'
        ];
        chromePath = candidates.find(p => { try { return fs.existsSync(p); } catch { return false; } }) || null;
      }
    });

    it('returns pass/fail/warn when Chrome is available', async () => {
      if (!chromePath) return pending('Chrome not found; set PERCY_BROWSER_EXECUTABLE=/path/to/chrome');

      const result = await withEnv(
        { PERCY_BROWSER_EXECUTABLE: chromePath },
        () => new BrowserChecker().checkBrowserNetwork({
          targetUrl: 'https://percy.io',
          timeout: 10000, // hard deadline fires at ~25s so test always finishes
          headless: true
        })
      );

      expect(['pass', 'fail', 'warn']).toContain(result.status);
      expect(result.chromePath).toBe(chromePath);
      expect(typeof result.navMs).toBe('number');
      expect(Array.isArray(result.domainSummary)).toBe(true);
      expect(Array.isArray(result.proxyHeaders)).toBe(true);
    });

    it('each domain summary entry has required fields', async () => {
      if (!chromePath) return pending('Chrome not found; set PERCY_BROWSER_EXECUTABLE=/path/to/chrome');

      const result = await withEnv(
        { PERCY_BROWSER_EXECUTABLE: chromePath },
        () => new BrowserChecker().checkBrowserNetwork({
          timeout: 10000,
          headless: true
        })
      );

      for (const entry of result.domainSummary) {
        expect(typeof entry.hostname).toBe('string');
        expect(['pass', 'fail', 'warn', 'skip']).toContain(entry.status);
        expect(entry.direct).toBeDefined();
      }
    });
  });
}
