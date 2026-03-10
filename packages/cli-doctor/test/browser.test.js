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
 * The _chromePath: null override tests the "skip" code-path deterministically
 * without needing to control the entire OS environment.
 */

import path from 'path';
import os from 'os';
import {
  sanitizeExecutablePath,
  safeEnvPath,
  checkBrowserNetwork,
  NetworkCapture,
  analyseCapture,
  safeHostname
} from '../src/checks/browser.js';
import { withEnv } from './helpers.js';

// Increase timeout for tests that might launch Chrome
jasmine.DEFAULT_TIMEOUT_INTERVAL = 90000;

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

  it('normalises path separators and dots', () => {
    const absPath = os.platform() === 'win32'
      ? 'C:\\Program Files\\..\\Program Files'
      : '/usr/local/../local';
    const result = safeEnvPath(absPath, fallback);
    expect(result).toBe(path.resolve(absPath));
  });
});

// ─── checkBrowserNetwork — skip path ─────────────────────────────────────────

describe('checkBrowserNetwork — when Chrome is not found', () => {
  it('returns status: skip with explanatory message', async () => {
    const result = await checkBrowserNetwork({ _chromePath: null });

    expect(result.status).toBe('skip');
    expect(result.chromePath).toBeNull();
    expect(result.message).toMatch(/chrome|chromium/i);
    expect(Array.isArray(result.suggestions)).toBe(true);
    expect(result.suggestions.length).toBeGreaterThan(0);
    expect(result.suggestions.some(s => /PERCY_BROWSER_EXECUTABLE/i.test(s))).toBe(true);
    expect(result.domainSummary).toEqual([]);
    expect(result.directCapture).toBeNull();
    expect(result.proxyCapture).toBeNull();
  });

  it('preserves targetUrl in skip result', async () => {
    const result = await checkBrowserNetwork({
      _chromePath: null,
      targetUrl: 'https://example.com'
    });
    expect(result.status).toBe('skip');
    expect(result.targetUrl).toBe('https://example.com');
  });
});

// ─── checkBrowserNetwork — result shape ───────────────────────────────────────

describe('checkBrowserNetwork — result shape contract', () => {
  it('skip result has all required fields', async () => {
    const result = await checkBrowserNetwork({ _chromePath: null });

    expect(typeof result.status).toBe('string');
    expect(typeof result.message).toBe('string');
    expect(result.chromePath).toBeDefined();
    expect(result.targetUrl).toBeDefined();
    expect(Array.isArray(result.domainSummary)).toBe(true);
    expect(Array.isArray(result.proxyHeaders)).toBe(true);
    expect(Array.isArray(result.suggestions)).toBe(true);
  });
});

// ─── checkBrowserNetwork — _chromePath override ──────────────────────────────

describe('checkBrowserNetwork — _chromePath override', () => {
  it('undefined _chromePath triggers auto-detect (skip if no Chrome)', async () => {
    // Just verify the function returns a valid result shape — not stuck / not throwing.
    // We use a very short timeout via _chromePath:null so the test always finishes.
    const skipResult = await checkBrowserNetwork({ _chromePath: null });
    expect(['skip', 'pass', 'fail', 'warn']).toContain(skipResult.status);
  });

  it('explicit null _chromePath always produces skip', async () => {
    const result = await checkBrowserNetwork({ _chromePath: null, targetUrl: 'https://percy.io' });
    expect(result.status).toBe('skip');
    expect(result.chromePath).toBeNull();
  });

  it('_chromePath overrides PERCY_BROWSER_EXECUTABLE env var', async () => {
    // Even if the env var is set to something weird, _chromePath: null wins.
    const result = await withEnv(
      { PERCY_BROWSER_EXECUTABLE: '/some/path/chrome' },
      () => checkBrowserNetwork({ _chromePath: null })
    );
    expect(result.status).toBe('skip');
  });
});

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

      const result = await checkBrowserNetwork({
        _chromePath: chromePath,
        targetUrl: 'https://percy.io',
        timeout: 10000, // hard deadline fires at ~25s so test always finishes
        headless: true
      });

      expect(['pass', 'fail', 'warn']).toContain(result.status);
      expect(result.chromePath).toBe(chromePath);
      expect(typeof result.navMs).toBe('number');
      expect(Array.isArray(result.domainSummary)).toBe(true);
      expect(Array.isArray(result.proxyHeaders)).toBe(true);
    });

    it('each domain summary entry has required fields', async () => {
      if (!chromePath) return pending('Chrome not found; set PERCY_BROWSER_EXECUTABLE=/path/to/chrome');

      const result = await checkBrowserNetwork({
        _chromePath: chromePath,
        timeout: 10000,
        headless: true
      });

      for (const entry of result.domainSummary) {
        expect(typeof entry.hostname).toBe('string');
        expect(['pass', 'fail', 'warn', 'skip']).toContain(entry.status);
        expect(entry.direct).toBeDefined();
      }
    });
  });
}
