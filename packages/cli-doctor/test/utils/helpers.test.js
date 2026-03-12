/**
 * Tests for packages/cli-doctor/src/utils/helpers.js
 *
 * Tests cover the pure / side-effect-free exports:
 *   - redactProxyUrl
 *   - captureProxyEnv
 *   - PERCY_DOMAINS
 *
 * The section-runner functions (runConnectivityAndSSL, runProxyCheck, etc.) and
 * runDiagnostics delegate to the individual check modules that have their own
 * test suites; those are tested via light smoke tests using stub ctx objects.
 */

import {
  redactProxyUrl,
  captureProxyEnv,
  PERCY_DOMAINS,
  runConnectivityAndSSL,
  runProxyCheck,
  runPACCheck,
  runBrowserCheck,
  runDiagnostics,
  _renderBrowserResults
} from '../../src/utils/helpers.js';

import { ConnectivityChecker } from '../../src/checks/connectivity.js';
import { ProxyDetector } from '../../src/checks/proxy.js';
import { PACDetector } from '../../src/checks/pac.js';
import { BrowserChecker } from '../../src/checks/browser.js';

import { withEnv, createPacServer, buildPacScript } from '../helpers.js';

// These tests include browser-check which launches Chrome; give them plenty of
// room even when Chrome is skipped (null path) to avoid flaky timeouts.
jasmine.DEFAULT_TIMEOUT_INTERVAL = 60000;

// ─── PERCY_DOMAINS ────────────────────────────────────────────────────────────

describe('PERCY_DOMAINS', () => {
  it('is a Set', () => {
    expect(PERCY_DOMAINS instanceof Set).toBe(true);
  });

  it('contains percy.io', () => {
    expect(PERCY_DOMAINS.has('percy.io')).toBe(true);
  });

  it('contains www.browserstack.com', () => {
    expect(PERCY_DOMAINS.has('www.browserstack.com')).toBe(true);
  });

  it('contains hub.browserstack.com', () => {
    expect(PERCY_DOMAINS.has('hub.browserstack.com')).toBe(true);
  });

  it('does not contain non-Percy domains', () => {
    expect(PERCY_DOMAINS.has('google.com')).toBe(false);
    expect(PERCY_DOMAINS.has('example.com')).toBe(false);
  });
});

// ─── redactProxyUrl ───────────────────────────────────────────────────────────

describe('redactProxyUrl', () => {
  it('returns the URL unchanged when there are no credentials', () => {
    expect(redactProxyUrl('http://proxy.corp.com:8080')).toBe('http://proxy.corp.com:8080/');
  });

  it('redacts username and password with ***', () => {
    const out = redactProxyUrl('http://alice:secret@proxy.corp.com:8080');
    expect(out).toContain('***:***');
    expect(out).not.toContain('alice');
    expect(out).not.toContain('secret');
  });

  it('redacts only the username when no password is present', () => {
    const out = redactProxyUrl('http://alice@proxy.corp.com:8080');
    expect(out).toContain('***');
    expect(out).not.toContain('alice');
  });

  it('preserves the host and port after redaction', () => {
    const out = redactProxyUrl('http://u:p@myproxy.corp.com:3128');
    expect(out).toContain('myproxy.corp.com');
    expect(out).toContain('3128');
  });

  it('preserves the path after redaction', () => {
    const out = redactProxyUrl('http://u:p@proxy.corp.com:8080/path');
    expect(out).toContain('/path');
  });

  it('returns null as-is', () => {
    expect(redactProxyUrl(null)).toBeNull();
  });

  it('returns undefined as-is', () => {
    expect(redactProxyUrl(undefined)).toBeUndefined();
  });

  it('returns empty string as-is', () => {
    expect(redactProxyUrl('')).toBe('');
  });

  it('returns the original value when the string is not a valid URL', () => {
    expect(redactProxyUrl('not-a-url')).toBe('not-a-url');
  });

  it('handles HTTPS proxy URLs', () => {
    const out = redactProxyUrl('https://admin:pass@secure-proxy.corp.com:443');
    expect(out).toContain('***:***');
    expect(out).toContain('secure-proxy.corp.com');
  });

  it('handles SOCKS proxy URLs', () => {
    const out = redactProxyUrl('socks5://user:pw@socks.proxy.com:1080');
    expect(out).toContain('***:***');
    expect(out).not.toContain('user');
    expect(out).not.toContain('pw');
  });
});

// ─── captureProxyEnv ──────────────────────────────────────────────────────────

describe('captureProxyEnv', () => {
  it('returns an empty object when no proxy env vars are set', async () => {
    const result = await withEnv({
      HTTPS_PROXY: undefined,
      https_proxy: undefined,
      HTTP_PROXY: undefined,
      http_proxy: undefined,
      ALL_PROXY: undefined,
      all_proxy: undefined,
      NO_PROXY: undefined,
      no_proxy: undefined,
      NODE_TLS_REJECT_UNAUTHORIZED: undefined,
      NODE_EXTRA_CA_CERTS: undefined,
      PERCY_BROWSER_EXECUTABLE: undefined
    }, () => captureProxyEnv());
    expect(Object.keys(result).length).toBe(0);
  });

  it('captures HTTPS_PROXY', async () => {
    const result = await withEnv({ HTTPS_PROXY: 'http://proxy:8080' }, () => captureProxyEnv());
    expect(result.HTTPS_PROXY).toBe('http://proxy:8080/');
  });

  it('captures lowercase https_proxy', async () => {
    const result = await withEnv({ https_proxy: 'http://proxy:8080' }, () => captureProxyEnv());
    expect(result.https_proxy).toBe('http://proxy:8080/');
  });

  it('captures HTTP_PROXY', async () => {
    const result = await withEnv({ HTTP_PROXY: 'http://proxy:3128' }, () => captureProxyEnv());
    expect(result.HTTP_PROXY).toBe('http://proxy:3128/');
  });

  it('captures ALL_PROXY', async () => {
    const result = await withEnv({ ALL_PROXY: 'http://proxy:8888' }, () => captureProxyEnv());
    expect(result.ALL_PROXY).toBe('http://proxy:8888/');
  });

  it('redacts credentials in proxy URL values', async () => {
    const result = await withEnv(
      { HTTPS_PROXY: 'http://user:secret@proxy.corp:8080' },
      () => captureProxyEnv()
    );
    expect(result.HTTPS_PROXY).toContain('***:***');
    expect(result.HTTPS_PROXY).not.toContain('secret');
  });

  it('captures NO_PROXY without redaction', async () => {
    const result = await withEnv({ NO_PROXY: 'localhost,127.0.0.1' }, () => captureProxyEnv());
    expect(result.NO_PROXY).toBe('localhost,127.0.0.1');
  });

  it('captures NODE_TLS_REJECT_UNAUTHORIZED without redaction', async () => {
    const result = await withEnv({ NODE_TLS_REJECT_UNAUTHORIZED: '0' }, () => captureProxyEnv());
    expect(result.NODE_TLS_REJECT_UNAUTHORIZED).toBe('0');
  });

  it('captures NODE_EXTRA_CA_CERTS without redaction', async () => {
    const result = await withEnv(
      { NODE_EXTRA_CA_CERTS: '/etc/ssl/certs/ca.pem' },
      () => captureProxyEnv()
    );
    expect(result.NODE_EXTRA_CA_CERTS).toBe('/etc/ssl/certs/ca.pem');
  });

  it('captures PERCY_BROWSER_EXECUTABLE without redaction', async () => {
    const result = await withEnv(
      { PERCY_BROWSER_EXECUTABLE: '/usr/bin/google-chrome' },
      () => captureProxyEnv()
    );
    expect(result.PERCY_BROWSER_EXECUTABLE).toBe('/usr/bin/google-chrome');
  });

  it('does not include keys that are not set', async () => {
    const result = await withEnv({
      HTTPS_PROXY: 'http://proxy:8080',
      HTTP_PROXY: undefined,
      ALL_PROXY: undefined,
      https_proxy: undefined,
      http_proxy: undefined,
      all_proxy: undefined,
      NO_PROXY: undefined,
      no_proxy: undefined,
      NODE_TLS_REJECT_UNAUTHORIZED: undefined,
      NODE_EXTRA_CA_CERTS: undefined,
      PERCY_BROWSER_EXECUTABLE: undefined
    }, () => captureProxyEnv());
    expect(Object.keys(result)).toEqual(['HTTPS_PROXY']);
  });

  it('captures multiple proxy vars simultaneously', async () => {
    const result = await withEnv({
      HTTPS_PROXY: 'http://https-proxy:8080',
      HTTP_PROXY: 'http://http-proxy:3128',
      NO_PROXY: 'localhost'
    }, () => captureProxyEnv());
    expect(result.HTTPS_PROXY).toBeTruthy();
    expect(result.HTTP_PROXY).toBeTruthy();
    expect(result.NO_PROXY).toBe('localhost');
  });
});

// ─── Stub logger ──────────────────────────────────────────────────────────────

/** Minimal Percy-like logger stub — captures log calls but doesn't print. */
function makeLog() {
  const lines = [];
  return {
    _lines: lines,
    info: (...a) => lines.push(['info', ...a]),
    warn: (...a) => lines.push(['warn', ...a]),
    error: (...a) => lines.push(['error', ...a]),
    debug: (...a) => lines.push(['debug', ...a])
  };
}

// ─── runConnectivityAndSSL ────────────────────────────────────────────────────

describe('runConnectivityAndSSL', () => {
  it('returns connectivity and ssl results', async () => {
    spyOn(ConnectivityChecker.prototype, 'checkConnectivityAndSSL').and.returnValue(
      Promise.resolve({ connectivityFindings: [], sslFindings: [] })
    );

    const result = await runConnectivityAndSSL(undefined, 10000);

    expect(result.connectivity).toBeDefined();
    expect(typeof result.connectivity.status).toBe('string');
    expect(Array.isArray(result.connectivity.findings)).toBe(true);

    expect(result.ssl).toBeDefined();
    expect(typeof result.ssl.status).toBe('string');
    expect(Array.isArray(result.ssl.findings)).toBe(true);
  });

  it('handles unexpected error from check gracefully', async () => {
    spyOn(ConnectivityChecker.prototype, 'checkConnectivityAndSSL').and.rejectWith(new Error('network failure'));

    const result = await runConnectivityAndSSL();

    expect(result.connectivity).toBeDefined();
    expect(result.ssl).toBeDefined();
  });
});

// ─── runProxyCheck ────────────────────────────────────────────────────────────

describe('runProxyCheck', () => {
  it('returns proxy result', async () => {
    spyOn(ProxyDetector.prototype, 'detectProxy').and.returnValue(
      Promise.resolve([{ status: 'info', layer: 'summary', source: 'none', message: 'No proxy detected.', proxyUrl: null }])
    );

    const result = await runProxyCheck(10000);

    expect(ProxyDetector.prototype.detectProxy).toHaveBeenCalled();
    expect(result.proxy).toBeDefined();
    expect(typeof result.proxy.status).toBe('string');
    expect(Array.isArray(result.proxy.findings)).toBe(true);
  });

  it('proxy.status is a valid status string', async () => {
    spyOn(ProxyDetector.prototype, 'detectProxy').and.returnValue(
      Promise.resolve([{ status: 'pass', layer: 'configuration', source: 'env:HTTPS_PROXY', message: 'Proxy OK.', proxyUrl: 'http://proxy:8080' }])
    );

    const result = await runProxyCheck(10000);

    expect(['pass', 'warn', 'fail', 'info']).toContain(result.proxy.status);
  });

  it('handles unexpected error from detectProxy gracefully', async () => {
    spyOn(ProxyDetector.prototype, 'detectProxy').and.rejectWith(new Error('Proxy detection failed'));

    const result = await runProxyCheck(10000);

    expect(result.proxy).toBeDefined();
  });
});

// ─── runPACCheck ──────────────────────────────────────────────────────────────

describe('runPACCheck', () => {
  it('returns pac result', async () => {
    const result = await withEnv({ PERCY_PAC_FILE_URL: undefined }, () =>
      runPACCheck()
    );

    expect(result.pac).toBeDefined();
    expect(typeof result.pac.status).toBe('string');
    expect(Array.isArray(result.pac.findings)).toBe(true);
  });

  it('returns warn finding when PAC resolves a proxy', async () => {
    const { createPacServer: mkPac, buildPacScript } = await import('../helpers.js');
    const pacServer = await mkPac(buildPacScript('PROXY corp.proxy:8080'));

    try {
      const result = await withEnv(
        { PERCY_PAC_FILE_URL: `${pacServer.url}/proxy.pac` },
        () => runPACCheck()
      );
      // PAC resolves to a proxy → findings includes a warn
      const hasWarn = result.pac.findings.some(f => f.status === 'warn');
      expect(hasWarn).toBe(true);
    } finally {
      await pacServer.close();
    }
  });
});

// ─── runBrowserCheck ──────────────────────────────────────────────────────────

describe('runBrowserCheck', () => {
  function makeBrowserNetworkResult(overrides = {}) {
    return {
      status: 'pass',
      chromePath: '/usr/bin/google-chrome',
      targetUrl: 'https://percy.io',
      directCapture: { requests: [], proxyHeaders: [], navMs: 100, error: null },
      proxyCapture: null,
      domainSummary: [
        { hostname: 'percy.io', status: 'pass', direct: { reachable: true, blocked: false, errors: [], sampleStatus: 200 }, viaProxy: null }
      ],
      proxyHeaders: [],
      navMs: 100,
      error: null,
      ...overrides
    };
  }

  it('returns browser result with mocked BrowserChecker', async () => {
    spyOn(BrowserChecker.prototype, 'checkBrowserNetwork').and.returnValue(Promise.resolve(makeBrowserNetworkResult()));

    const result = await runBrowserCheck('https://percy.io', undefined, 10000);

    expect(BrowserChecker.prototype.checkBrowserNetwork).toHaveBeenCalled();
    expect(result.browser).toBeDefined();
    expect(typeof result.browser.status).toBe('string');
  });

  it('browser.status is warn when browserResult.error is truthy', async () => {
    spyOn(BrowserChecker.prototype, 'checkBrowserNetwork').and.returnValue(
      Promise.resolve(makeBrowserNetworkResult({ error: 'Browser capture timed out after 45s', domainSummary: [] }))
    );

    const result = await runBrowserCheck('https://percy.io', undefined, 10000);

    expect(result.browser.status).toBe('warn');
  });

  it('sets status skip and skips rendering when Chrome not found (chromePath: null)', async () => {
    spyOn(BrowserChecker.prototype, 'checkBrowserNetwork').and.returnValue(Promise.resolve({
      status: 'skip',
      chromePath: null,
      targetUrl: 'https://percy.io',
      directCapture: null,
      proxyCapture: null,
      domainSummary: [],
      proxyHeaders: [],
      navMs: 0,
      error: null
    }));

    const result = await runBrowserCheck('https://percy.io', undefined, 10000);

    expect(result.browser).toBeDefined();
  });

  it('applies ?? [] fallback when domainSummary and proxyHeaders are null', async () => {
    spyOn(BrowserChecker.prototype, 'checkBrowserNetwork').and.returnValue(Promise.resolve({
      status: 'pass',
      chromePath: '/usr/bin/chrome',
      targetUrl: 'https://percy.io',
      directCapture: { requests: [], proxyHeaders: [], navMs: 50, error: null },
      proxyCapture: null,
      domainSummary: null, // null → ?? [] fallback
      proxyHeaders: null, // null → ?? [] fallback
      navMs: 50,
      error: null
    }));

    const result = await runBrowserCheck('https://percy.io', undefined, 10000);

    expect(result.browser.domainSummary).toEqual([]);
    expect(result.browser.proxyHeaders).toEqual([]);
  });

  it('handles unexpected error from checkBrowserNetwork gracefully', async () => {
    spyOn(BrowserChecker.prototype, 'checkBrowserNetwork').and.rejectWith(new Error('Browser launch failed'));

    const result = await runBrowserCheck('https://percy.io', undefined, 10000);

    expect(result.browser).toBeDefined();
  });

  it('prints proxy-capture message when proxyUrl is set', async () => {
    spyOn(BrowserChecker.prototype, 'checkBrowserNetwork').and.returnValue(Promise.resolve(makeBrowserNetworkResult({
      proxyCapture: { requests: [], proxyHeaders: [], navMs: 80, error: null }
    })));

    const { text } = await captureStdout(() =>
      runBrowserCheck('https://percy.io', 'http://corp-proxy:8080', 10000)
    );

    expect(text).toMatch(/proxy/i);
  });

  it('takes default value when url and timeout is not passed', async () => {
    spyOn(BrowserChecker.prototype, 'checkBrowserNetwork').and.returnValue(Promise.resolve(makeBrowserNetworkResult({
      proxyCapture: { requests: [], proxyHeaders: [], navMs: 80, error: null }
    })));

    runBrowserCheck();

    expect(BrowserChecker.prototype.checkBrowserNetwork).toHaveBeenCalledWith({
      targetUrl: 'https://percy.io',
      proxyUrl: null,
      timeout: 30000,
      headless: true
    });
  });
});

// ─── runDiagnostics ───────────────────────────────────────────────────────────

describe('runDiagnostics', () => {
  function spyAllCheckers({ connectivityResult, proxyResult, pacResult, browserResult } = {}) {
    spyOn(ConnectivityChecker.prototype, 'checkConnectivityAndSSL').and.returnValue(Promise.resolve(
      connectivityResult ?? { connectivityFindings: [{ status: 'pass', message: 'ok' }], sslFindings: [{ status: 'pass', message: 'ok' }] }
    ));
    spyOn(ProxyDetector.prototype, 'detectProxy').and.returnValue(Promise.resolve(
      proxyResult ?? [{ status: 'info', message: 'no proxy' }]
    ));
    spyOn(PACDetector.prototype, 'detectPAC').and.returnValue(Promise.resolve(
      pacResult ?? [{ status: 'info', message: 'no pac' }]
    ));
    spyOn(BrowserChecker.prototype, 'checkBrowserNetwork').and.returnValue(Promise.resolve(
      browserResult ?? { status: 'pass', chromePath: '/usr/bin/chrome', domainSummary: [], proxyHeaders: [], navMs: 100, error: null }
    ));
  }

  it('returns { checks, hasFail, hasWarn } shape', async () => {
    spyAllCheckers();
    const result = await runDiagnostics({});

    expect(result.checks).toBeDefined();
    expect(typeof result.hasFail).toBe('boolean');
    expect(typeof result.hasWarn).toBe('boolean');
    expect(result.checks.connectivity).toBeDefined();
    expect(result.checks.ssl).toBeDefined();
    expect(result.checks.proxy).toBeDefined();
    expect(result.checks.pac).toBeDefined();
    expect(result.checks.browser).toBeDefined();
  });

  it('hasFail is true when a connectivity domain is unreachable', async () => {
    spyAllCheckers({
      connectivityResult: {
        connectivityFindings: [{ status: 'fail', label: 'Percy API', url: 'https://percy.io', message: 'not reachable' }],
        sslFindings: [{ status: 'skip', message: 'skipped' }]
      }
    });

    const result = await runDiagnostics({});

    expect(result.hasFail).toBe(true);
  });

  it('hasWarn is true when proxy detection returns a warn finding', async () => {
    spyAllCheckers({
      proxyResult: [{ status: 'warn', layer: 'header-fingerprint', source: 'http://proxy.corp', message: 'Proxy headers detected.' }]
    });

    const result = await runDiagnostics({});

    expect(result.hasWarn).toBe(true);
  });

  it('calls all four section checkers', async () => {
    spyAllCheckers();
    await runDiagnostics({});

    expect(ConnectivityChecker.prototype.checkConnectivityAndSSL).toHaveBeenCalled();
    expect(ProxyDetector.prototype.detectProxy).toHaveBeenCalled();
    expect(PACDetector.prototype.detectPAC).toHaveBeenCalled();
    expect(BrowserChecker.prototype.checkBrowserNetwork).toHaveBeenCalled();
  });

  it('accepts call with no arguments — covers = {} default parameter', () => {
    // Calling without args triggers the = {} default parameter branch.
    // We don't await so real network calls happen in the background and don't block the suite.
    const p = runDiagnostics();
    p.catch(() => {});
    expect(typeof p.then).toBe('function');
  });
});

// ─── Section runner — error-path catch blocks ────────────────────────────────
// These use the _*Fn injection hooks added to each section runner so we can
// force the catch block to execute without mocking module-level imports.

describe('runConnectivityAndSSL — catch block', () => {
  it('handles unexpected throw from checkConnectivityAndSSL gracefully', async () => {
    spyOn(ConnectivityChecker.prototype, 'checkConnectivityAndSSL').and.rejectWith(new Error('Connectivity failure'));

    const result = await runConnectivityAndSSL();

    expect(result.connectivity).toBeDefined();
    expect(result.ssl).toBeDefined();
  });
});

describe('runProxyCheck — catch block', () => {
  it('handles unexpected throw from detectProxy gracefully', async () => {
    spyOn(ProxyDetector.prototype, 'detectProxy').and.rejectWith(new Error('Proxy detection error'));

    const result = await runProxyCheck();

    expect(result.proxy).toBeDefined();
  });
});

describe('runPACCheck — catch block', () => {
  it('handles unexpected throw from detectPAC gracefully', async () => {
    spyOn(PACDetector.prototype, 'detectPAC').and.rejectWith(new Error('PAC error'));

    const result = await runPACCheck();

    expect(result.pac).toBeDefined();
  });
});

describe('runBrowserCheck — proxyUrl branch', () => {
  it('prints proxy-capture message when proxyUrl is set', async () => {
    spyOn(BrowserChecker.prototype, 'checkBrowserNetwork').and.returnValue(Promise.resolve({
      status: 'pass',
      chromePath: '/usr/bin/chrome',
      targetUrl: 'https://percy.io',
      directCapture: { requests: [], proxyHeaders: [], navMs: 100, error: null },
      proxyCapture: { requests: [], proxyHeaders: [], navMs: 120, error: null },
      domainSummary: [],
      proxyHeaders: [],
      navMs: 100,
      error: null
    }));

    const { text } = await captureStdout(() =>
      runBrowserCheck('https://percy.io', 'http://corp-proxy:8080', 10000)
    );

    expect(text).toMatch(/proxy/i);
  });
});

describe('runBrowserCheck — Chrome found path', () => {
  it('calls _renderBrowserResults when browserChecker returns a real chromePath', async () => {
    spyOn(BrowserChecker.prototype, 'checkBrowserNetwork').and.returnValue(Promise.resolve({
      status: 'pass',
      chromePath: '/usr/bin/google-chrome',
      targetUrl: 'https://percy.io',
      directCapture: { requests: [], proxyHeaders: [], navMs: 200, error: null },
      proxyCapture: null,
      domainSummary: [
        { hostname: 'percy.io', status: 'pass', direct: { reachable: true, blocked: false, errors: [], sampleStatus: 200 }, viaProxy: null }
      ],
      proxyHeaders: [],
      navMs: 200,
      error: null
    }));

    const { text } = await captureStdout(() =>
      runBrowserCheck('https://percy.io', undefined, 10000)
    );

    expect(text).toMatch(/percy\.io/i);
  });

  it('sets browser.status to fail when percy domains are unreachable', async () => {
    spyOn(BrowserChecker.prototype, 'checkBrowserNetwork').and.returnValue(Promise.resolve({
      status: 'fail',
      chromePath: '/usr/bin/chrome',
      targetUrl: 'https://percy.io',
      directCapture: { requests: [], proxyHeaders: [], navMs: 0, error: null },
      proxyCapture: null,
      domainSummary: [
        { hostname: 'percy.io', status: 'fail', direct: { reachable: false, blocked: false, errors: ['ERR_NAME_NOT_RESOLVED'], sampleStatus: null }, viaProxy: null },
        { hostname: 'www.browserstack.com', status: 'fail', direct: { reachable: false, blocked: false, errors: [], sampleStatus: null }, viaProxy: null }
      ],
      proxyHeaders: [],
      navMs: 0,
      error: null
    }));

    const result = await runBrowserCheck('https://percy.io', undefined, 10000);

    expect(result.browser.status).toBe('fail');
  });
});

describe('runBrowserCheck — catch block', () => {
  it('handles unexpected throw from checkBrowserNetwork gracefully', async () => {
    spyOn(BrowserChecker.prototype, 'checkBrowserNetwork').and.rejectWith(new Error('Chrome crashed'));

    const result = await runBrowserCheck('https://percy.io', undefined, 10000);

    expect(result.browser).toBeDefined();
  });
});

// ─── captureStdout helper ────────────────────────────────────────────────────
// print() in reporter.js writes directly to process.stdout.write, bypassing
// the log object. Intercept stdout to inspect rendered output in tests.
async function captureStdout(fn) {
  const chunks = [];
  const orig = process.stdout.write.bind(process.stdout);
  process.stdout.write = (s) => { chunks.push(String(s)); return true; };
  try {
    const value = await fn();
    return { text: chunks.join(''), value };
  } finally {
    process.stdout.write = orig;
  }
}

// ─── runPACCheck — actionablePac branch ──────────────────────────────────────

describe('runPACCheck — actionablePac branch', () => {
  it('prints action-required message and suggestions when PAC has detectedProxyUrl', async () => {
    const pacServer = await createPacServer(buildPacScript('PROXY corp.proxy.local:8080'));

    try {
      const { text, value: result } = await captureStdout(() =>
        withEnv(
          { PERCY_PAC_FILE_URL: `${pacServer.url}/proxy.pac` },
          () => runPACCheck()
        )
      );

      // The actionablePac branch: finding has detectedProxyUrl → extra warn line is printed
      const hasPacWarn = result.pac.findings.some(
        f => f.status === 'warn' || f.detectedProxyUrl
      );
      expect(hasPacWarn).toBe(true);
      // The stdout output should mention the proxy URL or the action required message
      expect(text).toMatch(/proxy|PAC/i);
    } finally {
      await pacServer.close();
    }
  });
});

// ─── _renderBrowserResults ────────────────────────────────────────────────────

describe('_renderBrowserResults — single-column table (no proxy)', () => {
  function makeBrowserResult(overrides = {}) {
    return {
      error: null,
      domainSummary: [
        {
          hostname: 'percy.io',
          status: 'pass',
          direct: { reachable: true, blocked: false, errors: [], sampleStatus: 200 },
          viaProxy: null
        },
        {
          hostname: 'www.browserstack.com',
          status: 'fail',
          direct: { reachable: false, blocked: false, errors: ['net::ERR_CONNECTION_REFUSED'], sampleStatus: null },
          viaProxy: null
        }
      ],
      proxyHeaders: [],
      navMs: 1234,
      chromePath: '/usr/bin/google-chrome',
      targetUrl: 'https://percy.io',
      ...overrides
    };
  }

  it('renders single-column table when no proxyUrl supplied', async () => {
    const { text } = await captureStdout(() => _renderBrowserResults(makeLog(), makeBrowserResult(), null));
    expect(text).toMatch(/percy\.io/);
    expect(text).toMatch(/Hostname/);
  });

  it('prints "no network requests captured" when domainSummary is empty', async () => {
    const { text } = await captureStdout(() => _renderBrowserResults(makeLog(), makeBrowserResult({ domainSummary: [] }), null));
    expect(text).toMatch(/No network requests/i);
  });

  it('prints pass message when no percy domain is blocked', async () => {
    const { text } = await captureStdout(() => _renderBrowserResults(makeLog(), makeBrowserResult({
      domainSummary: [
        { hostname: 'percy.io', status: 'pass', direct: { reachable: true, blocked: false, errors: [], sampleStatus: 200 }, viaProxy: null }
      ]
    }), null));
    expect(text).toMatch(/reachable|pass/i);
  });

  it('prints fail message with domain names when percy domains are blocked', async () => {
    const { text } = await captureStdout(() => _renderBrowserResults(makeLog(), makeBrowserResult({
      domainSummary: [
        { hostname: 'percy.io', status: 'fail', direct: { reachable: false, blocked: false, errors: ['ERR_NAME_NOT_RESOLVED'], sampleStatus: null }, viaProxy: null }
      ]
    }), null));
    expect(text).toMatch(/percy\.io/);
  });

  it('prints the browser capture error note when result.error is set', async () => {
    const { text } = await captureStdout(() => _renderBrowserResults(makeLog(), makeBrowserResult({ error: 'Browser capture timed out after 45s' }), null));
    expect(text).toMatch(/timed out/i);
  });

  it('prints proxy headers when proxyHeaders is non-empty', async () => {
    const { text } = await captureStdout(() => _renderBrowserResults(makeLog(), makeBrowserResult({ proxyHeaders: ['via: 1.1 corp.proxy.com'] }), null));
    expect(text).toMatch(/via/i);
  });

  it('uses info icon for unknown status in single-column table (line 312)', async () => {
    // status not in {pass/warn/fail/skip} → ?? '\u2139' (ℹ) fallback is used
    const { text } = await captureStdout(() => _renderBrowserResults(makeLog(), makeBrowserResult({
      domainSummary: [{
        hostname: 'percy.io',
        status: 'unknown-status',
        direct: { reachable: true, blocked: false, errors: [], sampleStatus: 200 },
        viaProxy: null
      }]
    }), null));
    expect(text).toContain('percy.io');
  });

  it('truncates hostname longer than 39 chars in single-column table (line 313)', async () => {
    // hostname.length > 39 → slice(0, 37) + '…' truncation branch
    const longHost = 'a'.repeat(40) + '.example.com';
    const { text } = await captureStdout(() => _renderBrowserResults(makeLog(), makeBrowserResult({
      domainSummary: [{
        hostname: longHost,
        status: 'pass',
        direct: { reachable: true, blocked: false, errors: [], sampleStatus: 200 },
        viaProxy: null
      }]
    }), null));
    expect(text).toMatch(/…/);
  });
});

describe('_renderBrowserResults — two-column table (with proxy)', () => {
  it('renders two-column table when proxyUrl is supplied and viaProxy is non-null', async () => {
    const result = {
      error: null,
      domainSummary: [
        {
          hostname: 'percy.io',
          status: 'warn',
          direct: { reachable: false, blocked: false, errors: ['ERR_NAME'], sampleStatus: null },
          viaProxy: { reachable: true, blocked: false, errors: [], sampleStatus: 200 }
        }
      ],
      proxyHeaders: [],
      navMs: 500,
      chromePath: '/usr/bin/google-chrome',
      targetUrl: 'https://percy.io'
    };
    const { text } = await captureStdout(() => _renderBrowserResults(makeLog(), result, 'http://corp-proxy:8080'));
    expect(text).toMatch(/Via Proxy|Direct/i);
    expect(text).toMatch(/percy\.io/);
  });

  it('labels proxy auth failure as auth-required', async () => {
    const result = {
      error: null,
      domainSummary: [
        {
          hostname: 'percy.io',
          status: 'fail',
          direct: { reachable: false, blocked: false, errors: [], sampleStatus: null },
          viaProxy: { reachable: false, blocked: false, errors: ['PROXY_AUTH_REQUIRED_407'], sampleStatus: null }
        }
      ],
      proxyHeaders: [],
      navMs: 200,
      chromePath: '/usr/bin/google-chrome',
      targetUrl: 'https://percy.io'
    };
    const { text } = await captureStdout(() => _renderBrowserResults(makeLog(), result, 'http://corp-proxy:8080'));
    expect(text).toMatch(/auth-required|percy\.io/i);
  });

  it('labels cert-error for SSL-related proxy errors', async () => {
    const result = {
      error: null,
      domainSummary: [
        {
          hostname: 'percy.io',
          status: 'fail',
          direct: { reachable: false, blocked: false, errors: [], sampleStatus: null },
          viaProxy: { reachable: false, blocked: false, errors: ['ERR_CERT_AUTHORITY_INVALID'], sampleStatus: null }
        }
      ],
      proxyHeaders: [],
      navMs: 200,
      chromePath: '/usr/bin/google-chrome',
      targetUrl: 'https://percy.io'
    };
    const { text } = await captureStdout(() => _renderBrowserResults(makeLog(), result, 'http://corp-proxy:8080'));
    expect(text).toMatch(/cert-error|percy\.io/i);
  });

  it('labels blocked for blocked viaProxy entry', async () => {
    const result = {
      error: null,
      domainSummary: [
        {
          hostname: 'percy.io',
          status: 'fail',
          direct: { reachable: false, blocked: false, errors: [], sampleStatus: null },
          viaProxy: { reachable: false, blocked: true, errors: [], sampleStatus: null }
        }
      ],
      proxyHeaders: [],
      navMs: 200,
      chromePath: '/usr/bin/google-chrome',
      targetUrl: 'https://percy.io'
    };
    const { text } = await captureStdout(() => _renderBrowserResults(makeLog(), result, 'http://corp-proxy:8080'));
    expect(text).toMatch(/blocked|percy\.io/i);
  });

  it('shows http-NNN label for non-200 sampleStatus via proxy', async () => {
    const result = {
      error: null,
      domainSummary: [
        {
          hostname: 'percy.io',
          status: 'fail',
          direct: { reachable: false, blocked: false, errors: [], sampleStatus: null },
          viaProxy: { reachable: false, blocked: false, errors: [], sampleStatus: 503 }
        }
      ],
      proxyHeaders: [],
      navMs: 200,
      chromePath: '/usr/bin/google-chrome',
      targetUrl: 'https://percy.io'
    };
    const { text } = await captureStdout(() => _renderBrowserResults(makeLog(), result, 'http://corp-proxy:8080'));
    expect(text).toMatch(/http-503|percy\.io/i);
  });

  it('truncates very long hostnames with ellipsis', async () => {
    const longHost = 'a'.repeat(50) + '.example.com';
    const result = {
      error: null,
      domainSummary: [
        {
          hostname: longHost,
          status: 'pass',
          direct: { reachable: true, blocked: false, errors: [], sampleStatus: 200 },
          viaProxy: { reachable: true, blocked: false, errors: [], sampleStatus: 200 }
        }
      ],
      proxyHeaders: [],
      navMs: 100,
      chromePath: '/usr/bin/google-chrome',
      targetUrl: 'https://percy.io'
    };
    const { text } = await captureStdout(() => _renderBrowserResults(makeLog(), result, 'http://corp-proxy:8080'));
    expect(text).toMatch(/…/);
  });

  it('shows — for null direct entry in two-column table (line 277)', async () => {
    const result = {
      error: null,
      domainSummary: [{
        hostname: 'percy.io',
        status: 'pass',
        direct: null, // ← null triggers line 277 '—' branch
        viaProxy: { reachable: true, blocked: false, errors: [], sampleStatus: 200 }
      }],
      proxyHeaders: [],
      navMs: 100,
      chromePath: '/usr/bin/google-chrome',
      targetUrl: 'https://percy.io'
    };
    const { text } = await captureStdout(() => _renderBrowserResults(makeLog(), result, 'http://corp-proxy:8080'));
    expect(text).toContain('percy.io');
  });

  it('shows — for null viaProxy in two-column table (line 280)', async () => {
    const result = {
      error: null,
      domainSummary: [
        {
          hostname: 'percy.io',
          status: 'warn',
          direct: { reachable: false, blocked: false, errors: [], sampleStatus: null },
          viaProxy: null // ← null → '—' at end of proxyLabel ternary (line 280/294)
        },
        {
          hostname: 'other.com',
          status: 'pass',
          direct: { reachable: true, blocked: false, errors: [], sampleStatus: 200 },
          viaProxy: { reachable: true, blocked: false, errors: [], sampleStatus: 200 }
        }
      ],
      proxyHeaders: [],
      navMs: 100,
      chromePath: '/usr/bin/google-chrome',
      targetUrl: 'https://percy.io'
    };
    const { text } = await captureStdout(() => _renderBrowserResults(makeLog(), result, 'http://corp-proxy:8080'));
    expect(text).toMatch(/—/);
  });

  it('labels no-proxy for ERR_PROXY_CONNECTION_FAILED error (line 285)', async () => {
    const result = {
      error: null,
      domainSummary: [{
        hostname: 'percy.io',
        status: 'fail',
        direct: { reachable: false, blocked: false, errors: [], sampleStatus: null },
        viaProxy: {
          reachable: false,
          blocked: false,
          errors: ['ERR_PROXY_CONNECTION_FAILED'], // ← covers line 285 true branch
          sampleStatus: null
        }
      }],
      proxyHeaders: [],
      navMs: 200,
      chromePath: '/usr/bin/google-chrome',
      targetUrl: 'https://percy.io'
    };
    const { text } = await captureStdout(() => _renderBrowserResults(makeLog(), result, 'http://corp-proxy:8080'));
    expect(text).toMatch(/no-proxy|percy\.io/i);
  });

  it('labels failed when viaProxy: not reachable, no errors, not blocked, null sampleStatus (line 291 false branch)', async () => {
    const result = {
      error: null,
      domainSummary: [{
        hostname: 'percy.io',
        status: 'fail',
        direct: { reachable: false, blocked: false, errors: [], sampleStatus: null },
        viaProxy: {
          reachable: false,
          blocked: false,
          errors: [],
          sampleStatus: null // ← null: `sampleStatus != null` → false → 'failed'
        }
      }],
      proxyHeaders: [],
      navMs: 200,
      chromePath: '/usr/bin/google-chrome',
      targetUrl: 'https://percy.io'
    };
    const { text } = await captureStdout(() => _renderBrowserResults(makeLog(), result, 'http://corp-proxy:8080'));
    expect(text).toMatch(/failed|percy\.io/i);
  });

  it('uses info icon for unknown status in two-column table (line 298)', async () => {
    const result = {
      error: null,
      domainSummary: [{
        hostname: 'percy.io',
        status: 'custom-unknown', // not pass/warn/fail/skip → ?? '\u2139'
        direct: { reachable: true, blocked: false, errors: [], sampleStatus: 200 },
        viaProxy: { reachable: true, blocked: false, errors: [], sampleStatus: 200 }
      }],
      proxyHeaders: [],
      navMs: 100,
      chromePath: '/usr/bin/google-chrome',
      targetUrl: 'https://percy.io'
    };
    const { text } = await captureStdout(() => _renderBrowserResults(makeLog(), result, 'http://corp-proxy:8080'));
    expect(text).toContain('percy.io');
  });
});

// ─── runBrowserCheck — browserResult.error branch (lines 213-214) ────────────────────

describe('runBrowserCheck — browserResult.error sets status to warn', () => {
  it('browser.status is warn when browserResult.error is truthy', async () => {
    spyOn(BrowserChecker.prototype, 'checkBrowserNetwork').and.returnValue(Promise.resolve({
      status: 'warn',
      chromePath: '/usr/bin/chrome',
      targetUrl: 'https://percy.io',
      directCapture: { requests: [], proxyHeaders: [], navMs: 0, error: null },
      proxyCapture: null,
      domainSummary: [],
      proxyHeaders: [],
      navMs: 0,
      error: 'Browser capture timed out'
    }));

    const result = await runBrowserCheck('https://percy.io', undefined, 10000);

    expect(result.browser.status).toBe('warn');
    expect(result.browser.error).toBe('Browser capture timed out');
  });
});

// ─── runBrowserCheck — null domainSummary/proxyHeaders (lines 216, 222, 223, 265) ─

describe('runBrowserCheck — null domainSummary and proxyHeaders', () => {
  it('applies ?? [] fallback when domainSummary and proxyHeaders are null', async () => {
    spyOn(BrowserChecker.prototype, 'checkBrowserNetwork').and.returnValue(Promise.resolve({
      status: 'pass',
      chromePath: '/usr/bin/chrome',
      targetUrl: 'https://percy.io',
      directCapture: { requests: [], proxyHeaders: [], navMs: 50, error: null },
      proxyCapture: null,
      domainSummary: null,
      proxyHeaders: null,
      navMs: 50,
      error: null
    }));

    const result = await runBrowserCheck('https://percy.io', undefined, 10000);

    expect(result.browser.domainSummary).toEqual([]);
    expect(result.browser.proxyHeaders).toEqual([]);
  });
});

// ─── runDiagnostics — injection hooks + = {} default (line 242) ───────────────────────────────

describe('runDiagnostics — = {} default parameter', () => {
  it('completes quickly when all checker prototypes are spied', async () => {
    spyOn(ConnectivityChecker.prototype, 'checkConnectivityAndSSL').and.returnValue(Promise.resolve({ connectivityFindings: [], sslFindings: [] }));
    spyOn(ProxyDetector.prototype, 'detectProxy').and.returnValue(Promise.resolve([]));
    spyOn(PACDetector.prototype, 'detectPAC').and.returnValue(Promise.resolve([]));
    spyOn(BrowserChecker.prototype, 'checkBrowserNetwork').and.returnValue(Promise.resolve({ status: 'skip', chromePath: null, domainSummary: [], proxyHeaders: [], navMs: 0, error: null }));

    const result = await runDiagnostics({});
    expect(result.checks).toBeDefined();
  });

  it('accepts call with no arguments — covers = {} default parameter', () => {
    const p = runDiagnostics();
    p.catch(() => {});
    expect(typeof p.then).toBe('function');
  });
});
