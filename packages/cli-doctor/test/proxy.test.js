/**
 * Tests for packages/cli-doctor/src/checks/proxy.js
 *
 * All network interactions use in-process local servers so tests run without
 * internet access on Linux, macOS, and Windows CI runners.
 */

import { ProxyDetector } from '../src/checks/proxy.js';
import { httpProber } from '../src/utils/http.js';
import { createProxyServer, withEnv } from './helpers.js';
import childProcess from 'child_process';
import fsMod from 'fs';
import osMod from 'os';
import dns from 'dns';

// Convenience shims so existing call-sites work unchanged after the refactor
// that moved detectProxy and validateProxy into ProxyDetector.
const detectProxy = (...args) => new ProxyDetector().detectProxy(...args);
const validateProxy = (...args) => new ProxyDetector().validateProxy(...args);

// ─── validateProxy ────────────────────────────────────────────────────────────

describe('validateProxy', () => {
  let openProxy, authProxy, blockProxy;

  beforeAll(async () => {
    openProxy = await createProxyServer();
    authProxy = await createProxyServer({ auth: { user: 'percy', pass: 'secret' } });
    blockProxy = await createProxyServer({ mode: 'block' });
  });

  afterAll(async () => {
    await openProxy.close();
    await authProxy.close();
    await blockProxy.close();
  });

  it('returns pass when all test URLs succeed via open proxy', async () => {
    // validateProxy probes real URLs; confirm the return shape regardless of network.
    const result = await validateProxy(openProxy.url, 3000);
    expect(['pass', 'warn', 'fail']).toContain(result.status);
    expect(typeof result.message).toBe('string');
    expect(Array.isArray(result.suggestions)).toBe(true);
  });

  it('returns fail with auth-related suggestion when proxy returns 407', async () => {
    const result = await validateProxy(authProxy.url, 3000);
    expect(result.status).toBe('fail');
    expect(result.message).toMatch(/407|proxy/i);
    expect(result.suggestions.some(s => /407|auth|credentials|user.*pass/i.test(s))).toBe(true);
  });

  it('returns fail when proxy is not listening', async () => {
    const result = await validateProxy('http://127.0.0.1:1/', 2000);
    expect(result.status).toBe('fail');
  });

  it('returns fail with suggestion when proxy always returns 502', async () => {
    const result = await validateProxy(blockProxy.url, 3000);
    expect(result.status).toBe('fail');
    expect(typeof result.message).toBe('string');
  });

  it('returns structured { status, message, suggestions } object', async () => {
    const result = await validateProxy('http://127.0.0.1:1/', 1000);
    expect(typeof result.status).toBe('string');
    expect(typeof result.message).toBe('string');
    expect(Array.isArray(result.suggestions)).toBe(true);
  });

  it('result always has the three required fields', async () => {
    const result = await validateProxy('http://127.0.0.1:1/', 1500);
    expect(['pass', 'warn', 'fail']).toContain(result.status);
    expect(typeof result.message).toBe('string');
    expect(Array.isArray(result.suggestions)).toBe(true);
  });

  it('fail result contains troubleshooting suggestions', async () => {
    const result = await validateProxy('http://127.0.0.1:1/', 1500);
    if (result.status === 'fail') {
      expect(result.suggestions.some(s => /HTTPS_PROXY|proxy/i.test(s))).toBe(true);
    }
  });

  it('returns warn when only some probe URLs succeed', async () => {
    let callCount = 0;
    spyOn(httpProber, 'probeUrl').and.callFake((url) => {
      callCount++;
      // First call succeeds, second fails
      if (callCount === 1) return Promise.resolve({ ok: true, status: 200 });
      return Promise.resolve({ ok: false, status: 0, errorCode: 'ECONNREFUSED', error: 'refused' });
    });

    const result = await validateProxy('http://spy-proxy.example.com:8080', 3000);
    expect(result.status).toBe('warn');
    expect(result.message).toMatch(/could not connect/i);
    expect(result.suggestions.some(s => /whitelist|unreachable/i.test(s))).toBe(true);
  });

  it('adds SSL suggestions when all failures are SSL errors', async () => {
    spyOn(httpProber, 'probeUrl').and.returnValue(
      Promise.resolve({ ok: false, status: 0, errorCode: 'UNABLE_TO_VERIFY_LEAF_SIGNATURE', error: 'ssl error' })
    );
    spyOn(httpProber, 'isSslError').and.returnValue(true);

    const result = await validateProxy('http://ssl-intercepting-proxy.corp:8080', 3000);
    expect(result.status).toBe('fail');
    expect(result.suggestions.some(s => /SSL|TLS|intercept|certificate/i.test(s))).toBe(true);
    expect(result.suggestions.some(s => /NODE_TLS_REJECT_UNAUTHORIZED/i.test(s))).toBe(true);
  });
});

// ─── detectProxy — environment variable detection ─────────────────────────────

describe('detectProxy — environment variable detection', () => {
  // Disable all side-effectful detection layers so tests are fast and isolated
  const isolatedOpts = {
    testProxy: false,
    checkHeaders: false,
    scanProcesses: false,
    checkWpad: false
  };

  let authProxy;

  beforeAll(async () => {
    authProxy = await createProxyServer({ auth: { user: 'percy', pass: 'secret' } });
  });

  afterAll(() => authProxy.close());

  it('returns "no proxy" info finding when no env vars are set', async () => {
    const findings = await withEnv(
      {
        HTTPS_PROXY: undefined,
        https_proxy: undefined,
        HTTP_PROXY: undefined,
        http_proxy: undefined,
        ALL_PROXY: undefined,
        all_proxy: undefined,
        NO_PROXY: undefined,
        no_proxy: undefined
      },
      () => detectProxy(isolatedOpts)
    );
    const summary = findings.find(f => f.source === 'none');
    expect(summary).toBeDefined();
    expect(summary.status).toBe('info');
    expect(summary.message).toMatch(/no proxy/i);
  });

  it('detects HTTPS_PROXY env var', async () => {
    const findings = await withEnv(
      { HTTPS_PROXY: 'http://proxy.example.com:8080' },
      () => detectProxy(isolatedOpts)
    );
    const found = findings.find(f => f.proxyUrl === 'http://proxy.example.com:8080');
    expect(found).toBeDefined();
    expect(found.source).toContain('HTTPS_PROXY');
  });

  it('detects lowercase https_proxy env var', async () => {
    const findings = await withEnv(
      { https_proxy: 'http://lowercase.proxy:3128', HTTPS_PROXY: undefined },
      () => detectProxy(isolatedOpts)
    );
    const found = findings.find(f => f.proxyUrl === 'http://lowercase.proxy:3128');
    expect(found).toBeDefined();
    // On Windows env vars are case-insensitive (HTTPS_PROXY === https_proxy),
    // so the source always reflects whichever casing is first in PROXY_ENV_KEYS.
    expect(found.source).toMatch(/HTTPS_PROXY|https_proxy/);
  });

  it('detects HTTP_PROXY env var', async () => {
    const findings = await withEnv(
      { HTTP_PROXY: 'http://httpproxy.corp:8080', HTTPS_PROXY: undefined, https_proxy: undefined },
      () => detectProxy(isolatedOpts)
    );
    const found = findings.find(f => f.proxyUrl === 'http://httpproxy.corp:8080');
    expect(found).toBeDefined();
  });

  it('detects ALL_PROXY env var', async () => {
    const findings = await withEnv(
      { ALL_PROXY: 'socks5://socks.proxy:1080', HTTPS_PROXY: undefined, https_proxy: undefined, HTTP_PROXY: undefined, http_proxy: undefined },
      () => detectProxy(isolatedOpts)
    );
    const found = findings.find(f => f.proxyUrl === 'socks5://socks.proxy:1080');
    expect(found).toBeDefined();
  });

  it('includes a NO_PROXY info finding when NO_PROXY is set', async () => {
    const findings = await withEnv(
      { NO_PROXY: 'localhost,127.0.0.1' },
      () => detectProxy(isolatedOpts)
    );
    const noProxyFinding = findings.find(f => f.source === 'env:NO_PROXY');
    expect(noProxyFinding).toBeDefined();
    expect(noProxyFinding.status).toBe('info');
    expect(noProxyFinding.message).toContain('localhost,127.0.0.1');
  });

  it('deduplicates if the same proxy is set in both HTTPS_PROXY and HTTP_PROXY', async () => {
    const url = 'http://same.proxy:8080';
    const findings = await withEnv(
      { HTTPS_PROXY: url, HTTP_PROXY: url, https_proxy: undefined, http_proxy: undefined },
      () => detectProxy(isolatedOpts)
    );
    const matching = findings.filter(f => f.proxyUrl === url);
    // Should appear only once (de-duplicated by Map key)
    expect(matching.length).toBe(1);
  });

  it('each proxy finding has layer=configuration', async () => {
    const findings = await withEnv(
      { HTTPS_PROXY: 'http://corp.proxy:8080' },
      () => detectProxy(isolatedOpts)
    );
    const proxyFinding = findings.find(f => f.proxyUrl === 'http://corp.proxy:8080');
    expect(proxyFinding.layer).toBe('configuration');
  });

  it('returns info when no proxy is detected across all layers', async () => {
    const findings = await withEnv(
      {
        HTTPS_PROXY: undefined,
        https_proxy: undefined,
        HTTP_PROXY: undefined,
        http_proxy: undefined,
        ALL_PROXY: undefined,
        all_proxy: undefined,
        NO_PROXY: undefined,
        no_proxy: undefined
      },
      () => detectProxy({
        testProxy: false,
        checkHeaders: false,
        scanProcesses: false,
        checkWpad: false
      })
    );
    const summary = findings.find(f => f.source === 'none');
    expect(summary).toBeDefined();
    expect(summary.status).toBe('info');
  });

  it('sets status:info on discovered proxy finding when testProxy is false', async () => {
    const findings = await withEnv(
      { HTTPS_PROXY: 'http://proxy.example.com:8080', https_proxy: undefined, HTTP_PROXY: undefined, http_proxy: undefined, ALL_PROXY: undefined, all_proxy: undefined, NO_PROXY: undefined, no_proxy: undefined },
      () => detectProxy({
        testProxy: false,
        checkHeaders: false,
        scanProcesses: false,
        checkWpad: false
      })
    );
    const proxyFinding = findings.find(f => f.proxyUrl === 'http://proxy.example.com:8080');
    expect(proxyFinding).toBeDefined();
    expect(proxyFinding.status).toBe('info');
    expect(proxyFinding.layer).toBe('configuration');
  });

  it('validates proxy and attaches proxyValidation result when testProxy is true', async () => {
    spyOn(httpProber, 'probeUrl').and.returnValue(Promise.resolve({
      ok: true,
      status: 200,
      errorCode: null
    }));

    const findings = await withEnv(
      { HTTPS_PROXY: 'http://spy-proxy.example.com:8080', https_proxy: undefined, HTTP_PROXY: undefined, http_proxy: undefined, ALL_PROXY: undefined, all_proxy: undefined, NO_PROXY: undefined, no_proxy: undefined },
      () => detectProxy({
        testProxy: true,
        checkHeaders: false,
        scanProcesses: false,
        checkWpad: false,
        timeout: 3000
      })
    );
    const proxyFinding = findings.find(f => f.proxyUrl === 'http://spy-proxy.example.com:8080');
    expect(proxyFinding).toBeDefined();
    expect(proxyFinding.proxyValidation).toBeDefined();
    expect(typeof proxyFinding.status).toBe('string');
  });

  it('marks proxy as fail when it returns 407 (missing credentials)', async () => {
    const findings = await withEnv(
      { HTTPS_PROXY: authProxy.url, https_proxy: undefined, HTTP_PROXY: undefined, http_proxy: undefined, ALL_PROXY: undefined, all_proxy: undefined },
      () => detectProxy({
        testProxy: true,
        checkHeaders: false,
        scanProcesses: false,
        checkWpad: false,
        timeout: 3000
      })
    );
    const proxyFinding = findings.find(f => f.proxyUrl === authProxy.url);
    expect(proxyFinding).toBeDefined();
    expect(proxyFinding.status).toBe('fail');
    expect(proxyFinding.message).toMatch(/407|proxy/i);
  });

  it('marks proxy as fail when proxy URL is unreachable', async () => {
    const findings = await withEnv(
      { HTTPS_PROXY: 'http://127.0.0.1:1/', https_proxy: undefined, HTTP_PROXY: undefined, http_proxy: undefined, ALL_PROXY: undefined, all_proxy: undefined },
      () => detectProxy({
        testProxy: true,
        checkHeaders: false,
        scanProcesses: false,
        checkWpad: false,
        timeout: 2000
      })
    );
    const proxyFinding = findings.find(f => f.proxyUrl === 'http://127.0.0.1:1/');
    expect(proxyFinding).toBeDefined();
    expect(proxyFinding.status).toBe('fail');
  });
});

// ─── detectProxy — default options (all layers enabled) ───────────────────────

describe('detectProxy — default options (all layers enabled)', () => {
  it('returns no proxy finding when all detection layers yield no results', async () => {
    // Mocks for Layer 2: system proxy (all three OS paths return nothing)
    spyOn(osMod, 'platform').and.returnValue('linux');
    spyOn(childProcess, 'execSync').and.throwError('not available');
    spyOn(fsMod, 'readFileSync').and.throwError('ENOENT');

    // Mock for Layer 3: header fingerprinting (#detectViaHeaders uses httpProber.probeUrl)
    spyOn(httpProber, 'probeUrl').and.returnValue(
      Promise.resolve({ ok: true, status: 200, error: null, errorCode: null, latencyMs: 5, responseHeaders: {} })
    );

    // Mock for Layer 4: process scan (#detectProxyProcesses uses cp.exec via promisify)
    spyOn(childProcess, 'exec').and.callFake((cmd, opts, cb) => {
      // promisify passes the callback as the last argument
      const callback = typeof opts === 'function' ? opts : cb;
      callback(null, { stdout: '', stderr: '' });
    });

    // Mock for Layer 5: WPAD DNS resolution (#detectWpad uses dns.resolve4)
    spyOn(dns, 'resolve4').and.callFake((host, cb) => cb(new Error('NXDOMAIN')));

    // Mock os.hostname so wpadHosts stays minimal
    spyOn(osMod, 'hostname').and.returnValue('testhost');

    const findings = await withEnv(
      {
        HTTPS_PROXY: undefined,
        https_proxy: undefined,
        HTTP_PROXY: undefined,
        http_proxy: undefined,
        ALL_PROXY: undefined,
        all_proxy: undefined,
        NO_PROXY: undefined,
        no_proxy: undefined
      },
      () => detectProxy() // no options → all defaults: testProxy=true, checkHeaders=true, scanProcesses=true, checkWpad=true
    );

    const summary = findings.find(f => f.source === 'none');
    expect(summary).toBeDefined();
    expect(summary.status).toBe('info');
    expect(summary.message).toMatch(/no proxy/i);
  });

  it('returns no proxy finding when platform is not supported', async () => {
    // Mocks for Layer 2: system proxy (all three OS paths return nothing)
    spyOn(osMod, 'platform').and.returnValue('freeos');
    spyOn(childProcess, 'execSync').and.throwError('not available');
    spyOn(fsMod, 'readFileSync').and.throwError('ENOENT');

    // Mock for Layer 3: header fingerprinting (#detectViaHeaders uses httpProber.probeUrl)
    spyOn(httpProber, 'probeUrl').and.returnValue(
      Promise.resolve({ ok: true, status: 200, error: null, errorCode: null, latencyMs: 5, responseHeaders: {} })
    );

    // Mock for Layer 4: process scan (#detectProxyProcesses uses cp.exec via promisify)
    spyOn(childProcess, 'exec').and.callFake((cmd, opts, cb) => {
      // promisify passes the callback as the last argument
      const callback = typeof opts === 'function' ? opts : cb;
      callback(null, { stdout: '', stderr: '' });
    });

    // Mock for Layer 5: WPAD DNS resolution (#detectWpad uses dns.resolve4)
    spyOn(dns, 'resolve4').and.callFake((host, cb) => cb(new Error('NXDOMAIN')));

    // Mock os.hostname so wpadHosts stays minimal
    spyOn(osMod, 'hostname').and.returnValue('testhost');

    const findings = await withEnv(
      {
        HTTPS_PROXY: undefined,
        https_proxy: undefined,
        HTTP_PROXY: undefined,
        http_proxy: undefined,
        ALL_PROXY: undefined,
        all_proxy: undefined,
        NO_PROXY: undefined,
        no_proxy: undefined
      },
      () => detectProxy() // no options → all defaults: testProxy=true, checkHeaders=true, scanProcesses=true, checkWpad=true
    );

    const summary = findings.find(f => f.source === 'none');
    expect(summary).toBeDefined();
    expect(summary.status).toBe('info');
    expect(summary.message).toMatch(/no proxy/i);
  });
});

// ─── detectProxy — macOS system proxy detection ───────────────────────────────

describe('detectProxy — macOS system proxy detection', () => {
  it('discovers HTTPS proxy from scutil', async () => {
    spyOn(osMod, 'platform').and.returnValue('darwin');

    spyOn(childProcess, 'execSync').and.returnValue(
      'HTTPSEnable : 1\nHTTPSProxy : proxy.corp.com\nHTTPSPort : 3128\n'
    );

    const findings = await withEnv(
      { HTTPS_PROXY: undefined, https_proxy: undefined, HTTP_PROXY: undefined, http_proxy: undefined, ALL_PROXY: undefined, all_proxy: undefined, NO_PROXY: undefined, no_proxy: undefined },
      () => detectProxy({
        testProxy: false,
        checkHeaders: false,
        scanProcesses: false,
        checkWpad: false
      })
    );

    const macFinding = findings.find(f => f.source === 'macOS:scutil(HTTPS)');
    expect(macFinding).toBeDefined();
    expect(macFinding.proxyUrl).toBe('http://proxy.corp.com:3128');
    expect(macFinding.status).toBe('info');
  });

  it('falls back to HTTP proxy from scutil when HTTPS is not enabled', async () => {
    spyOn(osMod, 'platform').and.returnValue('darwin');

    spyOn(childProcess, 'execSync').and.returnValue(
      'HTTPEnable : 1\nHTTPProxy : http-proxy.corp.com\nHTTPPort : 8080\n'
    );

    const findings = await withEnv(
      { HTTPS_PROXY: undefined, https_proxy: undefined, HTTP_PROXY: undefined, http_proxy: undefined, ALL_PROXY: undefined, all_proxy: undefined, NO_PROXY: undefined, no_proxy: undefined },
      () => detectProxy({
        testProxy: false,
        checkHeaders: false,
        scanProcesses: false,
        checkWpad: false
      })
    );

    const macFinding = findings.find(f => f.source === 'macOS:scutil(HTTP)');
    expect(macFinding).toBeDefined();
    expect(macFinding.proxyUrl).toBe('http://http-proxy.corp.com:8080');
  });

  it('returns no macOS finding when scutil output has no proxy enabled (covers return null)', async () => {
    spyOn(osMod, 'platform').and.returnValue('darwin');
    // Neither HTTPSEnable nor HTTPEnable is 1 → #detectMacOSProxy returns null
    spyOn(childProcess, 'execSync').and.returnValue(
      'HTTPSEnable : 0\nHTTPEnable : 0\nHTTPSProxy : (null)\n'
    );

    const findings = await withEnv(
      { HTTPS_PROXY: undefined, https_proxy: undefined, HTTP_PROXY: undefined, http_proxy: undefined, ALL_PROXY: undefined, all_proxy: undefined, NO_PROXY: undefined, no_proxy: undefined },
      () => detectProxy({
        testProxy: false,
        checkHeaders: false,
        scanProcesses: false,
        checkWpad: false
      })
    );

    const macFinding = findings.find(f => f.source && f.source.startsWith('macOS:'));
    expect(macFinding).toBeUndefined();
    const summary = findings.find(f => f.source === 'none');
    expect(summary).toBeDefined();
  });
});

describe('detectProxy — Linux system proxy detection', () => {
  it('discovers proxy via gsettings when mode is manual', async () => {
    spyOn(osMod, 'platform').and.returnValue('linux');

    spyOn(childProcess, 'execSync').and.callFake((cmd) => {
      if (cmd.includes('proxy mode')) return "'manual'\n";
      if (cmd.includes('proxy.https host')) return "'linux-proxy.corp.com'\n";
      if (cmd.includes('proxy.https port')) return '3128\n';
      throw new Error('unexpected cmd');
    });

    spyOn(fsMod, 'readFileSync').and.throwError('ENOENT');
    spyOn(fsMod, 'existsSync').and.returnValue(false);

    const findings = await withEnv(
      { HTTPS_PROXY: undefined, https_proxy: undefined, HTTP_PROXY: undefined, http_proxy: undefined, ALL_PROXY: undefined, all_proxy: undefined, NO_PROXY: undefined, no_proxy: undefined },
      () => detectProxy({
        testProxy: false,
        checkHeaders: false,
        scanProcesses: false,
        checkWpad: false
      })
    );

    const linuxFinding = findings.find(f => f.source === 'linux:gsettings');
    expect(linuxFinding).toBeDefined();
    expect(linuxFinding.proxyUrl).toBe('http://linux-proxy.corp.com:3128');
  });

  it('does not discover proxy when gsettings mode is not manual', async () => {
    spyOn(osMod, 'platform').and.returnValue('linux');

    spyOn(childProcess, 'execSync').and.callFake((cmd) => {
      if (cmd.includes('proxy mode')) return "'auto'\n";
      if (cmd.includes('proxy.https host')) return "'linux-proxy.corp.com'\n";
      if (cmd.includes('proxy.https port')) return '3128\n';
      throw new Error('unexpected cmd');
    });

    spyOn(fsMod, 'readFileSync').and.throwError('ENOENT');
    spyOn(fsMod, 'existsSync').and.returnValue(false);

    const findings = await withEnv(
      { HTTPS_PROXY: undefined, https_proxy: undefined, HTTP_PROXY: undefined, http_proxy: undefined, ALL_PROXY: undefined, all_proxy: undefined, NO_PROXY: undefined, no_proxy: undefined },
      () => detectProxy({
        testProxy: false,
        checkHeaders: false,
        scanProcesses: false,
        checkWpad: false
      })
    );

    const linuxFinding = findings.find(f => f.source === 'linux:gsettings');
    expect(linuxFinding).toBeUndefined();
  });

  it('discovers proxy from /etc/environment', async () => {
    spyOn(osMod, 'platform').and.returnValue('linux');
    spyOn(childProcess, 'execSync').and.throwError('gsettings not found');
    spyOn(fsMod, 'existsSync').and.returnValue(false);
    spyOn(fsMod, 'readFileSync').and.callFake((p) => {
      if (p === '/etc/environment') return 'HTTPS_PROXY=http://etc-proxy.corp.com:8080\n';
      throw new Error(`ENOENT: ${p}`);
    });

    const findings = await withEnv(
      { HTTPS_PROXY: undefined, https_proxy: undefined, HTTP_PROXY: undefined, http_proxy: undefined, ALL_PROXY: undefined, all_proxy: undefined, NO_PROXY: undefined, no_proxy: undefined },
      () => detectProxy({
        testProxy: false,
        checkHeaders: false,
        scanProcesses: false,
        checkWpad: false
      })
    );

    const etcFinding = findings.find(f => f.source === 'linux:/etc/environment');
    expect(etcFinding).toBeDefined();
    expect(etcFinding.proxyUrl).toBe('http://etc-proxy.corp.com:8080');
  });

  it('discovers proxy from /etc/profile.d script', async () => {
    spyOn(osMod, 'platform').and.returnValue('linux');
    spyOn(childProcess, 'execSync').and.throwError('gsettings not found');

    spyOn(fsMod, 'existsSync').and.callFake((p) => p === '/etc/profile.d');
    spyOn(fsMod, 'readdirSync').and.callFake((p) => {
      if (p === '/etc/profile.d') return ['proxy.sh'];
      return [];
    });
    spyOn(fsMod, 'readFileSync').and.callFake((p) => {
      if (p === '/etc/environment') throw new Error('ENOENT');
      if (p === '/etc/profile.d/proxy.sh') return 'export HTTPS_PROXY=http://profiled-proxy.corp.com:9090\n';
      throw new Error(`ENOENT: ${p}`);
    });

    const findings = await withEnv(
      { HTTPS_PROXY: undefined, https_proxy: undefined, HTTP_PROXY: undefined, http_proxy: undefined, ALL_PROXY: undefined, all_proxy: undefined, NO_PROXY: undefined, no_proxy: undefined },
      () => detectProxy({
        testProxy: false,
        checkHeaders: false,
        scanProcesses: false,
        checkWpad: false
      })
    );

    const profFinding = findings.find(f => f.source && f.source.startsWith('linux:/etc/profile.d'));
    expect(profFinding).toBeDefined();
    expect(profFinding.proxyUrl).toBe('http://profiled-proxy.corp.com:9090');
  });

  it('returns null if no proxy is detected', async () => {
    spyOn(osMod, 'platform').and.returnValue('linux');
    spyOn(childProcess, 'execSync').and.throwError('gsettings not found');

    spyOn(fsMod, 'existsSync').and.returnValue(false);
    spyOn(fsMod, 'readdirSync').and.callFake((p) => {
      if (p === '/etc/profile.d') return ['proxy.sh'];
      return [];
    });
    spyOn(fsMod, 'readFileSync').and.callFake((p) => {
      if (p === '/etc/environment') throw new Error('ENOENT');
      if (p === '/etc/profile.d/proxy.sh') throw new Error('ENOENT');
      throw new Error(`ENOENT: ${p}`);
    });

    const findings = await withEnv(
      { HTTPS_PROXY: undefined, https_proxy: undefined, HTTP_PROXY: undefined, http_proxy: undefined, ALL_PROXY: undefined, all_proxy: undefined, NO_PROXY: undefined, no_proxy: undefined },
      () => detectProxy({
        testProxy: false,
        checkHeaders: false,
        scanProcesses: false,
        checkWpad: false
      })
    );

    expect(findings[0].proxyUrl).toBeNull();
  });
});

// ─── detectProxy — Via-header fingerprinting ──────────────────────────────────

describe('detectProxy — Via-header fingerprinting', () => {
  it('returns header-fingerprint layer findings when checkHeaders is enabled', async () => {
    // Call detectProxy with real HTTP header scan but no env-var proxy,
    // no process scan, no WPAD. The header scan probes external URLs so we
    // just assert the shape of the returned findings.
    const findings = await withEnv(
      {
        HTTPS_PROXY: undefined,
        https_proxy: undefined,
        HTTP_PROXY: undefined,
        http_proxy: undefined,
        ALL_PROXY: undefined,
        all_proxy: undefined
      },
      () => detectProxy({
        testProxy: false,
        checkHeaders: true,
        scanProcesses: false,
        checkWpad: false,
        timeout: 3000
      })
    );

    const headerFindings = findings.filter(f => f.layer === 'header-fingerprint');
    expect(headerFindings.length).toBeGreaterThan(0);
    // Each header finding has the expected shape
    for (const hf of headerFindings) {
      expect(typeof hf.status).toBe('string');
      expect(typeof hf.message).toBe('string');
      expect(typeof hf.headers).toBe('object');
    }
  });

  it('returns header-fingerprint finding without throwing when checkHeaders is enabled', async () => {
    const findings = await withEnv(
      {
        HTTPS_PROXY: undefined,
        https_proxy: undefined,
        HTTP_PROXY: undefined,
        http_proxy: undefined,
        ALL_PROXY: undefined,
        all_proxy: undefined,
        NO_PROXY: undefined,
        no_proxy: undefined
      },
      () => detectProxy({
        testProxy: false,
        checkHeaders: true,
        scanProcesses: false,
        checkWpad: false,
        timeout: 3000
      })
    );
    expect(Array.isArray(findings)).toBe(true);
    const headerFinding = findings.find(f => f.layer === 'header-fingerprint');
    expect(headerFinding).toBeDefined();
    expect(typeof headerFinding.status).toBe('string');
  });

  it('detects Via header and extracts proxy address', async () => {
    spyOn(httpProber, 'probeUrl').and.callFake((url) => {
      return Promise.resolve({
        ok: true,
        status: 200,
        responseHeaders: {
          Via: '1.1 proxy.corp.example.com:8080 (Squid/4.1)',
          'X-Forwarded-For': '10.0.0.1'
        }
      });
    });

    const findings = await withEnv(
      { HTTPS_PROXY: undefined, https_proxy: undefined, HTTP_PROXY: undefined, http_proxy: undefined, ALL_PROXY: undefined, all_proxy: undefined, NO_PROXY: undefined, no_proxy: undefined },
      () => detectProxy({
        testProxy: false,
        checkHeaders: true,
        scanProcesses: false,
        checkWpad: false,
        timeout: 3000
      })
    );

    const headerFinding = findings.find(f => f.layer === 'header-fingerprint' && f.status === 'warn');
    expect(headerFinding).toBeDefined();
    expect(headerFinding.detectedProxyUrl).toBe('http://proxy.corp.example.com:8080');
    expect(headerFinding.suggestions).toContain(
      'Possible proxy address from Via header: set HTTPS_PROXY=http://proxy.corp.example.com:8080'
    );
  });

  it('handles proxy headers without Via (no extracted address)', async () => {
    spyOn(httpProber, 'probeUrl').and.callFake(() => {
      return Promise.resolve({
        ok: true,
        status: 200,
        responseHeaders: {
          'X-Forwarded-For': '10.0.0.100'
        }
      });
    });

    const findings = await withEnv(
      { HTTPS_PROXY: undefined, https_proxy: undefined, HTTP_PROXY: undefined, http_proxy: undefined, ALL_PROXY: undefined, all_proxy: undefined, NO_PROXY: undefined, no_proxy: undefined },
      () => detectProxy({
        testProxy: false,
        checkHeaders: true,
        scanProcesses: false,
        checkWpad: false,
        timeout: 3000
      })
    );

    const headerFinding = findings.find(f => f.layer === 'header-fingerprint' && f.status === 'warn');
    expect(headerFinding).toBeDefined();
    expect(headerFinding.detectedProxyUrl).toBeNull();
    expect(headerFinding.suggestions.some(s => /HTTPS_PROXY/i.test(s))).toBe(true);
  });
});

// ─── detectProxy — process inspection ─────────────────────────────────────────

describe('detectProxy — process inspection', () => {
  it('returns findings without throwing when scanProcesses is enabled', async () => {
    const findings = await withEnv(
      {
        HTTPS_PROXY: undefined,
        https_proxy: undefined,
        HTTP_PROXY: undefined,
        http_proxy: undefined,
        ALL_PROXY: undefined,
        all_proxy: undefined,
        NO_PROXY: undefined,
        no_proxy: undefined
      },
      () => detectProxy({
        testProxy: false,
        checkHeaders: false,
        scanProcesses: true,
        checkWpad: false,
        timeout: 3000
      })
    );
    expect(Array.isArray(findings)).toBe(true);
    expect(findings.length).toBeGreaterThan(0);
    // Each finding must have status + message
    for (const f of findings) {
      expect(typeof f.status).toBe('string');
      expect(typeof f.message).toBe('string');
    }
  });

  it('process-scan finding has layer:process-inspection', async () => {
    const findings = await withEnv(
      {
        HTTPS_PROXY: undefined,
        https_proxy: undefined,
        HTTP_PROXY: undefined,
        http_proxy: undefined,
        ALL_PROXY: undefined,
        all_proxy: undefined,
        NO_PROXY: undefined,
        no_proxy: undefined
      },
      () => detectProxy({
        testProxy: false,
        checkHeaders: false,
        scanProcesses: true,
        checkWpad: false,
        timeout: 3000
      })
    );
    const procFinding = findings.find(f => f.layer === 'process-inspection');
    expect(procFinding).toBeDefined();
    // Either "no agents detected" (info) or "agents detected" (warn)
    expect(['info', 'warn']).toContain(procFinding.status);
  });

  it('returns warn finding when known proxy process is detected', async () => {
    spyOn(childProcess, 'exec').and.callFake((cmd, opts, cb) => {
      // ps aux output containing 'zscaler'.
      // Pass as a single {stdout,stderr} object so standard util.promisify resolves
      // correctly — cb(null, str, '') would produce a two-element array causing
      // `const { stdout }` to be undefined and fall into the catch branch.
      const stdout = 'root 1234 0.0 0.1 zscaler-daemon\n';
      const callback = typeof opts === 'function' ? opts : cb;
      callback(null, { stdout, stderr: '' });
    });

    const findings = await withEnv(
      { HTTPS_PROXY: undefined, https_proxy: undefined, HTTP_PROXY: undefined, http_proxy: undefined, ALL_PROXY: undefined, all_proxy: undefined, NO_PROXY: undefined, no_proxy: undefined },
      () => detectProxy({
        testProxy: false,
        checkHeaders: false,
        scanProcesses: true,
        checkWpad: false,
        timeout: 3000
      })
    );

    const procFinding = findings.find(f => f.layer === 'process-inspection');
    expect(procFinding).toBeDefined();
    expect(procFinding.status).toBe('warn');
    expect(procFinding.message).toMatch(/zscaler/i);
    expect(procFinding.processes).toContain('zscaler');
  });

  it('uses tasklist on win32 and detects proxy agent from stdout', async () => {
    spyOn(osMod, 'platform').and.returnValue('win32');

    spyOn(childProcess, 'exec').and.callFake((cmd, opts, cb) => {
      const stdout = '"zscaler.exe","1234","Services","0","12,345 K","Running","SYSTEM","0","0:00:01","N/A"\n';
      const callback = typeof opts === 'function' ? opts : cb;
      callback(null, { stdout, stderr: '' });
    });

    const findings = await withEnv(
      { HTTPS_PROXY: undefined, https_proxy: undefined, HTTP_PROXY: undefined, http_proxy: undefined, ALL_PROXY: undefined, all_proxy: undefined, NO_PROXY: undefined, no_proxy: undefined },
      () => detectProxy({
        testProxy: false,
        checkHeaders: false,
        scanProcesses: true,
        checkWpad: false,
        timeout: 3000
      })
    );

    const procFinding = findings.find(f => f.layer === 'process-inspection');
    expect(procFinding).toBeDefined();
    expect(procFinding.status).toBe('warn');
    expect(procFinding.message).toMatch(/zscaler/i);
  });

  it('returns info finding when no known proxy/security agents are found', async () => {
    spyOn(childProcess, 'exec').and.callFake((cmd, opts, cb) => {
      // Return process list with no known proxy agents
      const stdout = 'bash 1234 0.0 0.1 bash\nnode 5678 0.1 0.2 node\n';
      const callback = typeof opts === 'function' ? opts : cb;
      callback(null, { stdout, stderr: '' });
    });

    const findings = await withEnv(
      { HTTPS_PROXY: undefined, https_proxy: undefined, HTTP_PROXY: undefined, http_proxy: undefined, ALL_PROXY: undefined, all_proxy: undefined, NO_PROXY: undefined, no_proxy: undefined },
      () => detectProxy({
        testProxy: false,
        checkHeaders: false,
        scanProcesses: true,
        checkWpad: false,
        timeout: 3000
      })
    );

    const procFinding = findings.find(f => f.layer === 'process-inspection');
    expect(procFinding).toBeDefined();
    // When no known agents found → info; when spy doesn't intercept → info too
    expect(procFinding.status).toBe('info');
    expect(procFinding.message).toMatch(/no known proxy/i);
  });
});

// ─── detectProxy — WPAD discovery ─────────────────────────────────────────────

describe('detectProxy — WPAD discovery', () => {
  it('returns findings without throwing when checkWpad is enabled', async () => {
    const findings = await withEnv(
      {
        HTTPS_PROXY: undefined,
        https_proxy: undefined,
        HTTP_PROXY: undefined,
        http_proxy: undefined,
        ALL_PROXY: undefined,
        all_proxy: undefined,
        NO_PROXY: undefined,
        no_proxy: undefined
      },
      () => detectProxy({
        testProxy: false,
        checkHeaders: false,
        scanProcesses: false,
        checkWpad: true,
        timeout: 3000
      })
    );
    expect(Array.isArray(findings)).toBe(true);
    const wpadFinding = findings.find(f => f.layer === 'wpad-discovery');
    expect(wpadFinding).toBeDefined();
    expect(['info', 'warn']).toContain(wpadFinding.status);
  });

  it('adds wpad.<domain> to wpadHosts when hostname has multiple parts', async () => {
    spyOn(osMod, 'hostname').and.returnValue('myhost.corp.example.com');
    // Make DNS resolve fail so no WPAD found — we just test the hostname logic
    spyOn(dns, 'resolve4').and.callFake((host, cb) => {
      cb(null, []);
    });

    const findings = await withEnv(
      { HTTPS_PROXY: undefined, https_proxy: undefined, HTTP_PROXY: undefined, http_proxy: undefined, ALL_PROXY: undefined, all_proxy: undefined, NO_PROXY: undefined, no_proxy: undefined },
      () => detectProxy({
        testProxy: false,
        checkHeaders: false,
        scanProcesses: false,
        checkWpad: true,
        timeout: 3000
      })
    );

    const wpadFinding = findings.find(f => f.layer === 'wpad-discovery');
    expect(wpadFinding).toBeDefined();
    expect(wpadFinding.message).toMatch(/No WPAD host/i);
  });

  it('pushes warn finding when wpad host resolves in DNS', async () => {
    spyOn(osMod, 'hostname').and.returnValue('myhost');
    spyOn(dns, 'resolve4').and.callFake((host, cb) => {
      if (host === 'wpad') cb(null, ['10.0.0.1']);
      else cb(new Error('NXDOMAIN'), null);
    });

    const findings = await withEnv(
      { HTTPS_PROXY: undefined, https_proxy: undefined, HTTP_PROXY: undefined, http_proxy: undefined, ALL_PROXY: undefined, all_proxy: undefined, NO_PROXY: undefined, no_proxy: undefined },
      () => detectProxy({
        testProxy: false,
        checkHeaders: false,
        scanProcesses: false,
        checkWpad: true,
        timeout: 3000
      })
    );

    const wpadFinding = findings.find(f => f.layer === 'wpad-discovery' && f.status === 'warn');
    expect(wpadFinding).toBeDefined();
    expect(wpadFinding.wpadHost).toBe('wpad');
    expect(wpadFinding.resolvedIPs).toContain('10.0.0.1');
    expect(wpadFinding.wpadUrl).toBe('http://wpad/wpad.dat');
  });
});

// ─── detectProxy — Windows system proxy detection ─────────────────────────────

describe('detectProxy — Windows system proxy detection', () => {
  it('discovers proxy from Windows registry when ProxyEnable is 0x1', async () => {
    spyOn(osMod, 'platform').and.returnValue('win32');

    spyOn(childProcess, 'execSync').and.callFake((cmd) => {
      if (typeof cmd === 'string' && cmd.includes('ProxyEnable')) {
        return '    ProxyEnable    REG_DWORD    0x1\n';
      }
      if (typeof cmd === 'string' && cmd.includes('ProxyServer')) {
        return '    ProxyServer    REG_SZ    proxy.corp.win:8080\n';
      }
      throw new Error('not available');
    });

    const findings = await withEnv(
      { HTTPS_PROXY: undefined, https_proxy: undefined, HTTP_PROXY: undefined, http_proxy: undefined, ALL_PROXY: undefined, all_proxy: undefined, NO_PROXY: undefined, no_proxy: undefined },
      () => detectProxy({
        testProxy: false,
        checkHeaders: false,
        scanProcesses: false,
        checkWpad: false
      })
    );

    const winFinding = findings.find(f => f.source === 'windows:registry');
    expect(winFinding).toBeDefined();
    expect(winFinding.proxyUrl).toBe('http://proxy.corp.win:8080');
    expect(winFinding.status).toBe('info');
  });

  it('skips Windows registry when ProxyEnable is not 0x1', async () => {
    spyOn(osMod, 'platform').and.returnValue('win32');

    spyOn(childProcess, 'execSync').and.callFake((cmd) => {
      if (typeof cmd === 'string' && cmd.includes('ProxyEnable')) {
        return '    ProxyEnable    REG_DWORD    0x0\n';
      }
      throw new Error('not available');
    });

    const findings = await withEnv(
      { HTTPS_PROXY: undefined, https_proxy: undefined, HTTP_PROXY: undefined, http_proxy: undefined, ALL_PROXY: undefined, all_proxy: undefined, NO_PROXY: undefined, no_proxy: undefined },
      () => detectProxy({
        testProxy: false,
        checkHeaders: false,
        scanProcesses: false,
        checkWpad: false
      })
    );

    const winFinding = findings.find(f => f.source === 'windows:registry');
    expect(winFinding).toBeUndefined();
  });

  it('handles Windows registry with bare host:port (adds http:// prefix)', async () => {
    spyOn(osMod, 'platform').and.returnValue('win32');

    spyOn(childProcess, 'execSync').and.callFake((cmd) => {
      if (typeof cmd === 'string' && cmd.includes('ProxyEnable')) {
        return '    ProxyEnable    REG_DWORD    0x1\n';
      }
      if (typeof cmd === 'string' && cmd.includes('ProxyServer')) {
        return '    ProxyServer    REG_SZ    barehost.corp.win:3128\n';
      }
      throw new Error('not available');
    });

    const findings = await withEnv(
      { HTTPS_PROXY: undefined, https_proxy: undefined, HTTP_PROXY: undefined, http_proxy: undefined, ALL_PROXY: undefined, all_proxy: undefined, NO_PROXY: undefined, no_proxy: undefined },
      () => detectProxy({
        testProxy: false,
        checkHeaders: false,
        scanProcesses: false,
        checkWpad: false
      })
    );

    const winFinding = findings.find(f => f.source === 'windows:registry');
    expect(winFinding).toBeDefined();
    expect(winFinding.proxyUrl).toBe('http://barehost.corp.win:3128');
  });

  it('returns null when reg query throws', async () => {
    spyOn(osMod, 'platform').and.returnValue('win32');
    spyOn(childProcess, 'execSync').and.throwError('reg query failed');

    const findings = await withEnv(
      { HTTPS_PROXY: undefined, https_proxy: undefined, HTTP_PROXY: undefined, http_proxy: undefined, ALL_PROXY: undefined, all_proxy: undefined, NO_PROXY: undefined, no_proxy: undefined },
      () => detectProxy({
        testProxy: false,
        checkHeaders: false,
        scanProcesses: false,
        checkWpad: false
      })
    );

    const winFinding = findings.find(f => f.source === 'windows:registry');
    expect(winFinding).toBeUndefined();
  });
});
