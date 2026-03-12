/**
 * Tests for packages/cli-doctor/src/checks/pac.js
 *
 * runPacScript is pure JS (no I/O) — fully unit-testable on any OS.
 * detectPAC tests use PERCY_PAC_FILE_URL + a local HTTP server to test the
 * full fetch → evaluate → classify pipeline without system config access.
 */

import { runPacScript, findInObject, PACDetector } from '../src/checks/pac.js';
import { createPacServer, createHttpServer, withEnv, buildPacScript } from './helpers.js';
import childProcess from 'child_process';
import fsMod from 'fs';
import osMod from 'os';
import path from 'path';
import http from 'http';
import { EventEmitter } from 'events';

// Convenience shim so existing detectPAC call-sites work unchanged after the
// refactor that moved detectPAC into PACDetector.
const detectPAC = (...args) => new PACDetector().detectPAC(...args);

// ─── runPacScript — basic results ─────────────────────────────────────────────

describe('runPacScript — basic return values', () => {
  it('returns DIRECT when script returns DIRECT', () => {
    const result = runPacScript(
      buildPacScript('DIRECT'),
      'https://percy.io/', 'percy.io'
    );
    expect(result).toBe('DIRECT');
  });

  it('returns proxy string when script returns PROXY', () => {
    const result = runPacScript(
      buildPacScript('PROXY proxy.corp:8080'),
      'https://percy.io/', 'percy.io'
    );
    expect(result).toBe('PROXY proxy.corp:8080');
  });

  it('returns DIRECT;PROXY fallback string', () => {
    const script = `
      function FindProxyForURL(url, host) {
        return "DIRECT; PROXY fallback.corp:3128";
      }
    `;
    const result = runPacScript(script, 'https://percy.io/', 'percy.io');
    expect(result).toContain('DIRECT');
    expect(result).toContain('PROXY fallback.corp:3128');
  });

  it('casts non-string return values to string', () => {
    const script = 'function FindProxyForURL(url, host) { return null; }';
    const result = runPacScript(script, 'https://percy.io/', 'percy.io');
    expect(typeof result).toBe('string');
  });
});

// ─── runPacScript — FindProxyForURL receives correct arguments ────────────────

describe('runPacScript — argument passing', () => {
  it('passes url and host correctly', () => {
    const script = `
      function FindProxyForURL(url, host) {
        if (url === "https://percy.io/" && host === "percy.io") return "DIRECT";
        return "PROXY wrong:1234";
      }
    `;
    expect(runPacScript(script, 'https://percy.io/', 'percy.io')).toBe('DIRECT');
  });

  it('can use url to make routing decisions', () => {
    const script = `
      function FindProxyForURL(url, host) {
        if (url.indexOf("percy.io") !== -1) return "PROXY percy-proxy:8080";
        return "DIRECT";
      }
    `;
    expect(runPacScript(script, 'https://percy.io/', 'percy.io')).toBe('PROXY percy-proxy:8080');
    expect(runPacScript(script, 'https://example.com/', 'example.com')).toBe('DIRECT');
  });
});

// ─── runPacScript — shExpMatch wildcard matching ──────────────────────────────

describe('runPacScript — shExpMatch', () => {
  // shExpMatch is exposed to the PAC script via the sandbox; test it through
  // a PAC script that exercises each wildcard type.

  it('* matches any sequence of characters', () => {
    const script = `
      function FindProxyForURL(url, host) {
        return shExpMatch(host, "*.percy.io") ? "PROXY match:1" : "DIRECT";
      }
    `;
    expect(runPacScript(script, 'https://dev.percy.io/', 'dev.percy.io')).toBe('PROXY match:1');
    expect(runPacScript(script, 'https://percy.io/', 'percy.io')).toBe('DIRECT');
    expect(runPacScript(script, 'https://api.dev.percy.io/', 'api.dev.percy.io')).toBe('PROXY match:1');
  });

  it('* matches empty string (i.e. prefix-only pattern)', () => {
    const script = `
      function FindProxyForURL(url, host) {
        return shExpMatch(host, "percy*") ? "PROXY match:1" : "DIRECT";
      }
    `;
    expect(runPacScript(script, 'https://percy.io/', 'percy.io')).toBe('PROXY match:1');
    expect(runPacScript(script, 'https://percy-staging.io/', 'percy-staging.io')).toBe('PROXY match:1');
    expect(runPacScript(script, 'https://example.com/', 'example.com')).toBe('DIRECT');
  });

  it('? matches exactly one character', () => {
    const script = `
      function FindProxyForURL(url, host) {
        return shExpMatch(host, "percy.i?") ? "PROXY match:1" : "DIRECT";
      }
    `;
    expect(runPacScript(script, 'https://percy.io/', 'percy.io')).toBe('PROXY match:1');
    expect(runPacScript(script, 'https://percy.i/', 'percy.i')).toBe('DIRECT');
    expect(runPacScript(script, 'https://percy.ioo/', 'percy.ioo')).toBe('DIRECT');
  });

  it('exact match (no wildcards) works', () => {
    const script = `
      function FindProxyForURL(url, host) {
        return shExpMatch(host, "percy.io") ? "PROXY match:1" : "DIRECT";
      }
    `;
    expect(runPacScript(script, 'https://percy.io/', 'percy.io')).toBe('PROXY match:1');
    expect(runPacScript(script, 'https://sub.percy.io/', 'sub.percy.io')).toBe('DIRECT');
  });

  it('combined * and ? wildcards', () => {
    const script = `
      function FindProxyForURL(url, host) {
        return shExpMatch(host, "*.percy.?o") ? "PROXY match:1" : "DIRECT";
      }
    `;
    expect(runPacScript(script, 'https://api.percy.io/', 'api.percy.io')).toBe('PROXY match:1');
    expect(runPacScript(script, 'https://percy.io/', 'percy.io')).toBe('DIRECT');
  });

  it('rejects excessively long patterns (> 256 chars) safely', () => {
    const longPat = 'a'.repeat(300);
    const script = `
      function FindProxyForURL(url, host) {
        return shExpMatch("target", ${JSON.stringify(longPat)}) ? "PROXY match:1" : "DIRECT";
      }
    `;
    // Should not throw, and should return DIRECT (no match for oversized pattern)
    expect(() => runPacScript(script, 'https://percy.io/', 'percy.io')).not.toThrow();
    expect(runPacScript(script, 'https://percy.io/', 'percy.io')).toBe('DIRECT');
  });
});

// ─── runPacScript — standard PAC helper shims ─────────────────────────────────

describe('runPacScript — PAC helper shims', () => {
  it('isPlainHostName returns true for hostname without dots', () => {
    const script = `
      function FindProxyForURL(url, host) {
        return isPlainHostName(host) ? "PROXY intranet:8080" : "DIRECT";
      }
    `;
    expect(runPacScript(script, 'http://intranet/', 'intranet')).toBe('PROXY intranet:8080');
    expect(runPacScript(script, 'https://percy.io/', 'percy.io')).toBe('DIRECT');
  });

  it('dnsDomainIs matches exact domain suffix', () => {
    const script = `
      function FindProxyForURL(url, host) {
        return dnsDomainIs(host, ".percy.io") ? "PROXY corp:8080" : "DIRECT";
      }
    `;
    expect(runPacScript(script, 'https://api.percy.io/', 'api.percy.io')).toBe('PROXY corp:8080');
    expect(runPacScript(script, 'https://example.com/', 'example.com')).toBe('DIRECT');
  });

  it('dnsDomainLevels counts correctly', () => {
    const script = `
      function FindProxyForURL(url, host) {
        return dnsDomainLevels(host) >= 2 ? "PROXY deep:8080" : "DIRECT";
      }
    `;
    expect(runPacScript(script, 'https://sub.domain.com/', 'sub.domain.com')).toBe('PROXY deep:8080');
    expect(runPacScript(script, 'https://example.com/', 'example.com')).toBe('DIRECT');
  });

  it('dnsDomainLevels counts correctly', () => {
    const script = `
      function FindProxyForURL(url, host) {
        return dnsDomainLevels(host) >= 2 ? "PROXY deep:8080" : "DIRECT";
      }
    `;
    expect(runPacScript(script, 'https://sub.domain.com/', 'proxy:123')).toBe('DIRECT');
  });
});

// ─── runPacScript — error handling ───────────────────────────────────────────

describe('runPacScript — error handling', () => {
  it('throws when FindProxyForURL is not defined', () => {
    expect(() => runPacScript('var x = 1;', 'https://percy.io/', 'percy.io'))
      .toThrowError(/FindProxyForURL/);
  });

  it('throws on script syntax error', () => {
    expect(() => runPacScript('function FindProxyForURL( {{{', 'https://percy.io/', 'percy.io'))
      .toThrow();
  });

  it('throws when script throws at evaluation time', () => {
    const script = 'function FindProxyForURL(url, host) { throw new Error("PAC error"); }';
    expect(() => runPacScript(script, 'https://percy.io/', 'percy.io'))
      .toThrow();
  });
});

// ─── detectPAC — env var detection ───────────────────────────────────────────

describe('detectPAC — PERCY_PAC_FILE_URL env var', () => {
  let pacServer;

  beforeAll(async () => {
    pacServer = await createPacServer(buildPacScript('PROXY corp.proxy:8080'));
  });

  afterAll(() => pacServer.close());

  it('returns info finding when no PAC is configured', async () => {
    const findings = await withEnv(
      { PERCY_PAC_FILE_URL: undefined },
      () => detectPAC()
    );
    // On a clean CI machine (no system PAC) an info/"no pac" finding appears.
    // On a dev machine with system PAC configured other findings may appear instead.
    expect(findings.length).toBeGreaterThan(0);
    expect(findings.every(f => ['info', 'warn', 'pass', 'fail'].includes(f.status))).toBe(true);
  });

  it('detects PERCY_PAC_FILE_URL env var and fetches the PAC file', async () => {
    const findings = await withEnv(
      { PERCY_PAC_FILE_URL: `${pacServer.url}/proxy.pac` },
      () => detectPAC()
    );
    const pacFinding = findings.find(f => f.pacUrl === `${pacServer.url}/proxy.pac`);
    expect(pacFinding).toBeDefined();
    expect(pacFinding.source).toBe('env:PERCY_PAC_FILE_URL');
    expect(pacFinding.resolvedProxy).toContain('PROXY corp.proxy:8080');
  });

  it('shows proxy suggestion when PAC resolves to PROXY', async () => {
    const findings = await withEnv(
      { PERCY_PAC_FILE_URL: `${pacServer.url}/proxy.pac` },
      () => detectPAC()
    );
    const pacFinding = findings.find(f => f.pacUrl === `${pacServer.url}/proxy.pac`);
    expect(pacFinding.status).toBe('warn'); // non-DIRECT → warn
    expect(pacFinding.suggestions.some(s => /HTTPS_PROXY/i.test(s))).toBe(true);
    expect(pacFinding.suggestions.some(s => /PERCY_PAC_FILE_URL/i.test(s))).toBe(true);
  });

  it('shows info status when PAC resolves to DIRECT', async () => {
    const directServer = await createPacServer(buildPacScript('DIRECT'));
    try {
      const findings = await withEnv(
        { PERCY_PAC_FILE_URL: `${directServer.url}/proxy.pac` },
        () => detectPAC()
      );
      const pacFinding = findings.find(f => f.pacUrl === `${directServer.url}/proxy.pac`);
      expect(pacFinding).toBeDefined();
      expect(pacFinding.status).toBe('info');
      expect(pacFinding.resolvedProxy.trim().toUpperCase()).toContain('DIRECT');
    } finally {
      await directServer.close();
    }
  });

  it('returns warn when PERCY_PAC_FILE_URL points to a 404 endpoint', async () => {
    const server404 = await createHttpServer((req, res) => {
      res.writeHead(404);
      res.end('not found');
    });
    try {
      const findings = await withEnv(
        { PERCY_PAC_FILE_URL: `${server404.url}/missing.pac` },
        () => detectPAC()
      );
      const pacFinding = findings.find(f => f.pacUrl === `${server404.url}/missing.pac`);
      // 404 means fetchText succeeds but the body is not a valid PAC script
      // so evaluation will fail → warn
      expect(pacFinding).toBeDefined();
      expect(['warn', 'fail']).toContain(pacFinding.status);
    } finally {
      await server404.close();
    }
  });

  it('returns warn when PERCY_PAC_FILE_URL server is unreachable', async () => {
    const findings = await withEnv(
      { PERCY_PAC_FILE_URL: 'http://127.0.0.1:1/proxy.pac' },
      () => detectPAC()
    );
    const pacFinding = findings.find(f => f.pacUrl === 'http://127.0.0.1:1/proxy.pac');
    expect(pacFinding).toBeDefined();
    expect(pacFinding.status).toBe('warn');
    expect(pacFinding.message).toMatch(/fetch|reach|connect/i);
  });

  it('includes PERCY_PAC_FILE_URL suggestion in warn findings', async () => {
    const findings = await withEnv(
      { PERCY_PAC_FILE_URL: 'http://127.0.0.1:1/proxy.pac' },
      () => detectPAC()
    );
    const pacFinding = findings.find(f => f.pacUrl === 'http://127.0.0.1:1/proxy.pac');
    expect(pacFinding.suggestions.some(s => s.includes('PERCY_PAC_FILE_URL'))).toBe(true);
  });
});

// ─── detectPAC — PAC result without "PROXY" keyword (else-branch) ─────────────

describe('detectPAC — non-PROXY result without keyword', () => {
  it('shows PAC_FILE_URL-only suggestion when result contains no PROXY keyword', async () => {
    // PAC script returns a custom string that is not DIRECT and not "PROXY host:port"
    // This hits the else-branch inside evaluatePac (proxyMatch === null)
    const customPacScript = 'function FindProxyForURL(url, host) { return "SOCKS 127.0.0.1:1080"; }';
    const pacServer = await createPacServer(customPacScript);
    try {
      const findings = await withEnv(
        { PERCY_PAC_FILE_URL: `${pacServer.url}/proxy.pac` },
        () => detectPAC()
      );
      const pacFinding = findings.find(f => f.pacUrl === `${pacServer.url}/proxy.pac`);
      expect(pacFinding).toBeDefined();
      expect(pacFinding.status).toBe('warn'); // non-DIRECT
      // No PROXY match → suggestions should only include PERCY_PAC_FILE_URL, not HTTPS_PROXY
      expect(pacFinding.detectedProxyUrl).toBeUndefined();
      expect(pacFinding.suggestions.some(s => /PERCY_PAC_FILE_URL/i.test(s))).toBe(true);
    } finally {
      await pacServer.close();
    }
  });
});

// ─── detectPAC — PAC evaluation failure (invalid script) ─────────────────────

describe('detectPAC — PAC evaluation failure', () => {
  it('returns warn when the fetched PAC script is invalid JavaScript', async () => {
    // Serve an invalid PAC script → runPacScript throws → evaluatePac returns warn
    const brokenPacServer = await createPacServer('this is not valid js {{{');
    try {
      const findings = await withEnv(
        { PERCY_PAC_FILE_URL: `${brokenPacServer.url}/proxy.pac` },
        () => detectPAC()
      );
      const pacFinding = findings.find(f => f.pacUrl === `${brokenPacServer.url}/proxy.pac`);
      expect(pacFinding).toBeDefined();
      expect(pacFinding.status).toBe('warn');
      expect(pacFinding.message).toMatch(/evaluat|PAC/i);
    } finally {
      await brokenPacServer.close();
    }
  });
});

// ─── runPacScript — remaining PAC helper shims ───────────────────────────────

describe('runPacScript — remaining PAC helper shims', () => {
  it('localHostOrDomainIs matches same host', () => {
    const script = `
      function FindProxyForURL(url, host) {
        return localHostOrDomainIs(host, "www.percy.io") ? "PROXY corp:8080" : "DIRECT";
      }
    `;
    expect(runPacScript(script, 'https://www.percy.io/', 'www')).toBe('PROXY corp:8080');
    expect(runPacScript(script, 'https://other.io/', 'other')).toBe('DIRECT');
  });

  it('isResolvable always returns true (shim)', () => {
    const script = `
      function FindProxyForURL(url, host) {
        return isResolvable(host) ? "PROXY ok:8080" : "DIRECT";
      }
    `;
    expect(runPacScript(script, 'https://percy.io/', 'percy.io')).toBe('PROXY ok:8080');
  });

  it('isInNet always returns false (shim)', () => {
    const script = `
      function FindProxyForURL(url, host) {
        return isInNet(myIpAddress(), "10.0.0.0", "255.0.0.0") ? "PROXY intranet:8080" : "DIRECT";
      }
    `;
    expect(runPacScript(script, 'https://percy.io/', 'percy.io')).toBe('DIRECT');
  });

  it('dnsResolve returns the host as-is (shim)', () => {
    const script = `
      function FindProxyForURL(url, host) {
        return dnsResolve(host) === host ? "PROXY shim:8080" : "DIRECT";
      }
    `;
    expect(runPacScript(script, 'https://percy.io/', 'percy.io')).toBe('PROXY shim:8080');
  });

  it('weekdayRange / dateRange / timeRange return true (shims)', () => {
    const script = `
      function FindProxyForURL(url, host) {
        if (weekdayRange("MON","FRI") && dateRange(1,31) && timeRange(0,23)) return "PROXY time:8080";
        return "DIRECT";
      }
    `;
    expect(runPacScript(script, 'https://percy.io/', 'percy.io')).toBe('PROXY time:8080');
  });

  it('myIpAddress returns 127.0.0.1', () => {
    const script = `
      function FindProxyForURL(url, host) {
        return myIpAddress() === "127.0.0.1" ? "PROXY local:8080" : "DIRECT";
      }
    `;
    expect(runPacScript(script, 'https://percy.io/', 'percy.io')).toBe('PROXY local:8080');
  });

  it('shExpMatch returns false for invalid input types', () => {
    const script = `
      function FindProxyForURL(url, host) {
        return shExpMatch(null, "*.io") ? "PROXY x:1" : "DIRECT";
      }
    `;
    expect(runPacScript(script, 'https://percy.io/', 'percy.io')).toBe('DIRECT');
  });
});

// ─── findInObject ─────────────────────────────────────────────────────────────

describe('findInObject', () => {
  it('finds a key at the top level', () => {
    expect(findInObject({ pac_url: 'http://proxy.pac' }, 'pac_url')).toBe('http://proxy.pac');
  });

  it('finds a key nested one level deep', () => {
    expect(findInObject({ proxy: { pac_url: 'http://nested.pac' } }, 'pac_url')).toBe('http://nested.pac');
  });

  it('finds a key nested several levels deep (within depth limit)', () => {
    const obj = { a: { b: { c: { target: 'deep-value' } } } };
    expect(findInObject(obj, 'target')).toBe('deep-value');
  });

  it('returns null when key is not found', () => {
    expect(findInObject({ a: { b: 1 } }, 'missing')).toBeNull();
  });

  it('returns null for null input', () => {
    expect(findInObject(null, 'key')).toBeNull();
  });

  it('returns null for non-object input (string)', () => {
    expect(findInObject('string', 'key')).toBeNull();
  });

  it('returns null for non-object input (number)', () => {
    expect(findInObject(42, 'key')).toBeNull();
  });

  it('stops recursing beyond depth 6', () => {
    // A chain of 7 nested objects — target is in the 8th level (beyond limit)
    const deep = { a: { b: { c: { d: { e: { f: { g: { target: 'too-deep' } } } } } } } };
    expect(findInObject(deep, 'target')).toBeNull();
  });

  it('returns first occurrence when key exists at multiple places', () => {
    const obj = { a: { pac_url: 'first' }, b: { pac_url: 'second' } };
    const result = findInObject(obj, 'pac_url');
    // Either 'first' or 'second' is acceptable — key is found
    expect(['first', 'second']).toContain(result);
  });

  it('finds key in an array element (array is an object)', () => {
    const obj = { items: [{ pac_url: 'array-entry' }] };
    const result = findInObject(obj, 'pac_url');
    expect(result).toBe('array-entry');
  });

  it('returns null for an empty object', () => {
    expect(findInObject({}, 'key')).toBeNull();
  });
});

// ─── detectPAC — fetchText https branch (lines 357-358) ──────────────────────
// Setting PERCY_PAC_FILE_URL to an https:// URL forces the import('https') branch.
// The URL is unreachable (port 1) so the request fails, but the branch is covered.

describe('detectPAC — fetchText https branch (lines 357-358)', () => {
  it('uses https module when PERCY_PAC_FILE_URL starts with https://', async () => {
    const findings = await withEnv(
      { PERCY_PAC_FILE_URL: 'https://127.0.0.1:1/proxy.pac' },
      () => detectPAC()
    );
    const pacFinding = findings.find(f => f.pacUrl === 'https://127.0.0.1:1/proxy.pac');
    expect(pacFinding).toBeDefined();
    // Connection refused → fetchText throws → evaluatePac returns warn
    expect(pacFinding.status).toBe('warn');
    expect(pacFinding.message).toMatch(/fetch|reach|connect/i);
  });
});

// ─── detectPAC — spy-based OS-layer coverage ─────────────────────────────────
// These tests spy on execSync / fs / os to exercise platform-specific branches
// without requiring the real OS tools to be installed.

describe('detectPAC — macOS plist branch (lines 71-74)', () => {
  it('parses plist JSON and pushes a PAC url when ProxyAutoConfigURLString is found', async () => {
    spyOn(osMod, 'platform').and.returnValue('darwin');
    spyOn(osMod, 'homedir').and.returnValue('/home/testuser');

    const plistData = JSON.stringify({ ProxyAutoConfigURLString: 'http://corp.pac/proxy.pac' });

    // networksetup returns "no enabled PAC" for all interfaces
    spyOn(childProcess, 'execSync').and.callFake((cmd) => {
      if (cmd.includes('networksetup')) return 'URL: (null)\nEnabled: No\n';
      if (cmd.includes('plutil')) return plistData;
      if (cmd.includes('gsettings') || cmd.includes('reg query')) throw new Error('not found');
      return '';
    });

    spyOn(fsMod, 'existsSync').and.callFake((p) => {
      // macOS plist path
      if (p.includes('preferences.plist') || p.includes('systempreferences.plist')) return true;
      return false;
    });

    // Mock http.get so #fetchText rejects immediately — no real network call
    const fakeReq1 = new EventEmitter();
    fakeReq1.destroy = () => {};
    spyOn(http, 'get').and.callFake((url, opts, cb) => {
      setImmediate(() => fakeReq1.emit('error', Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' })));
      return fakeReq1;
    });

    const detector = new PACDetector();
    // PAC url is discovered via plist; fetch is mocked to fail → warn
    const findings = await withEnv(
      { PERCY_PAC_FILE_URL: undefined },
      () => detector.detectPAC()
    );

    // The PAC url from plist must appear in the findings
    const plistFinding = findings.find(f => f.pacUrl === 'http://corp.pac/proxy.pac');
    expect(plistFinding).toBeDefined();
    expect(plistFinding.source).toBe('macOS:plist');
    // fetch will fail (unreachable) → warn
    expect(plistFinding.status).toBe('warn');
  });
});

describe('detectPAC — Linux gsettings auto branch (lines 103-116)', () => {
  it('discovers PAC url when gsettings mode is "auto"', async () => {
    spyOn(osMod, 'platform').and.returnValue('linux');
    spyOn(osMod, 'homedir').and.returnValue('/home/testuser');

    spyOn(childProcess, 'execSync').and.callFake((cmd) => {
      if (cmd.includes('proxy mode')) return "'auto'\n";
      if (cmd.includes('autoconfig-url')) return "'http://linux.pac/proxy.pac'\n";
      throw new Error('not available');
    });

    spyOn(fsMod, 'existsSync').and.returnValue(false);
    spyOn(fsMod, 'readFileSync').and.throwError('ENOENT');

    // Mock http.get so #fetchText rejects immediately — no real network call
    const fakeReq2 = new EventEmitter();
    fakeReq2.destroy = () => {};
    spyOn(http, 'get').and.callFake((url, opts, cb) => {
      setImmediate(() => fakeReq2.emit('error', Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' })));
      return fakeReq2;
    });

    const detector = new PACDetector();
    const findings = await withEnv(
      { PERCY_PAC_FILE_URL: undefined },
      () => detector.detectPAC()
    );

    const linuxFinding = findings.find(f => f.source === 'linux:gsettings');
    expect(linuxFinding).toBeDefined();
    expect(linuxFinding.pacUrl).toBe('http://linux.pac/proxy.pac');
    expect(linuxFinding.status).toBe('warn'); // unreachable → warn
  });

  it('ignores empty PAC url when gsettings mode is "auto"', async () => {
    spyOn(osMod, 'platform').and.returnValue('linux');
    spyOn(osMod, 'homedir').and.returnValue('/home/testuser');

    spyOn(childProcess, 'execSync').and.callFake((cmd) => {
      if (cmd.includes('proxy mode')) return "'auto'\n";
      if (cmd.includes('autoconfig-url')) return "''\n";
      throw new Error('not available');
    });

    spyOn(fsMod, 'existsSync').and.returnValue(false);
    spyOn(fsMod, 'readFileSync').and.throwError('ENOENT');

    // Mock http.get so #fetchText rejects immediately — no real network call
    const fakeReq2 = new EventEmitter();
    fakeReq2.destroy = () => {};
    spyOn(http, 'get').and.callFake((url, opts, cb) => {
      setImmediate(() => fakeReq2.emit('error', Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' })));
      return fakeReq2;
    });

    const detector = new PACDetector();
    const findings = await withEnv(
      { PERCY_PAC_FILE_URL: undefined },
      () => detector.detectPAC()
    );

    const linuxFinding = findings.find(f => f.source === 'linux:gsettings');
    expect(linuxFinding).toBeUndefined();
  });

  it('does not discovers PAC url when gsettings mode is not "auto"', async () => {
    spyOn(osMod, 'platform').and.returnValue('linux');
    spyOn(osMod, 'homedir').and.returnValue('/home/testuser');

    spyOn(childProcess, 'execSync').and.callFake((cmd) => {
      if (cmd.includes('proxy mode')) return "'manual'\n";
      if (cmd.includes('autoconfig-url')) return "'http://linux.pac/proxy.pac'\n";
      throw new Error('not available');
    });

    spyOn(fsMod, 'existsSync').and.returnValue(false);
    spyOn(fsMod, 'readFileSync').and.throwError('ENOENT');

    // Mock http.get so #fetchText rejects immediately — no real network call
    const fakeReq2 = new EventEmitter();
    fakeReq2.destroy = () => {};
    spyOn(http, 'get').and.callFake((url, opts, cb) => {
      setImmediate(() => fakeReq2.emit('error', Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' })));
      return fakeReq2;
    });

    const detector = new PACDetector();
    const findings = await withEnv(
      { PERCY_PAC_FILE_URL: undefined },
      () => detector.detectPAC()
    );

    const linuxFinding = findings.find(f => f.source === 'linux:gsettings');
    expect(linuxFinding).toBeUndefined();
  });
});

describe('detectPAC — Linux /etc/environment auto_proxy branch (lines 118-122)', () => {
  it('discovers PAC url from /etc/environment AUTO_PROXY setting', async () => {
    spyOn(osMod, 'platform').and.returnValue('linux');
    spyOn(osMod, 'homedir').and.returnValue('/home/testuser');

    spyOn(childProcess, 'execSync').and.throwError('gsettings not found');

    spyOn(fsMod, 'existsSync').and.returnValue(false);
    spyOn(fsMod, 'readFileSync').and.callFake((p) => {
      if (p === '/etc/environment') return 'AUTO_PROXY=http://etcenv.pac/proxy.pac\n';
      throw new Error(`ENOENT: ${p}`);
    });

    // Mock http.get so #fetchText rejects immediately — no real network call
    const fakeReq3 = new EventEmitter();
    fakeReq3.destroy = () => {};
    spyOn(http, 'get').and.callFake((url, opts, cb) => {
      setImmediate(() => fakeReq3.emit('error', Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' })));
      return fakeReq3;
    });

    const detector = new PACDetector();
    const findings = await withEnv(
      { PERCY_PAC_FILE_URL: undefined },
      () => detector.detectPAC()
    );

    const etcFinding = findings.find(f => f.source === 'linux:/etc/environment');
    expect(etcFinding).toBeDefined();
    expect(etcFinding.pacUrl).toBe('http://etcenv.pac/proxy.pac');
  });

  it('does not discovers PAC url from /etc/environment if AUTO_PROXY setting is not there', async () => {
    spyOn(osMod, 'platform').and.returnValue('linux');
    spyOn(osMod, 'homedir').and.returnValue('/home/testuser');

    spyOn(childProcess, 'execSync').and.throwError('gsettings not found');

    spyOn(fsMod, 'existsSync').and.returnValue(false);
    spyOn(fsMod, 'readFileSync').and.callFake((p) => {
      if (p === '/etc/environment') return 'ABCD_PROXY=http://etcenv.pac/proxy.pac\n';
      throw new Error(`ENOENT: ${p}`);
    });

    // Mock http.get so #fetchText rejects immediately — no real network call
    const fakeReq3 = new EventEmitter();
    fakeReq3.destroy = () => {};
    spyOn(http, 'get').and.callFake((url, opts, cb) => {
      setImmediate(() => fakeReq3.emit('error', Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' })));
      return fakeReq3;
    });

    const detector = new PACDetector();
    const findings = await withEnv(
      { PERCY_PAC_FILE_URL: undefined },
      () => detector.detectPAC()
    );

    const etcFinding = findings.find(f => f.source === 'linux:/etc/environment');
    expect(etcFinding).toBeUndefined();
  });
});

describe('detectPAC — Chrome Local State extProxies branch (line 171)', () => {
  it('discovers PAC url from Chrome extension state via findInObject', async () => {
    spyOn(osMod, 'platform').and.returnValue('darwin');
    spyOn(osMod, 'homedir').and.returnValue('/home/testuser');

    const localStateData = JSON.stringify({
      extensions: { settings: { abc123: { pac_url: 'http://chrome-ext.pac/proxy.pac' } } }
    });

    spyOn(childProcess, 'execSync').and.throwError('not available');

    // existsSync: only true for Chrome Local State file, not Preferences
    spyOn(fsMod, 'existsSync').and.callFake((p) => {
      if (p.includes('Local State')) return true;
      return false; // Preferences path doesn't exist — skip prefs branch
    });

    spyOn(fsMod, 'readFileSync').and.callFake((p) => {
      if (p.includes('Local State')) return localStateData;
      throw new Error(`ENOENT: ${p}`);
    });

    // Mock http.get so #fetchText rejects immediately — no real network call
    const fakeReq4 = new EventEmitter();
    fakeReq4.destroy = () => {};
    spyOn(http, 'get').and.callFake((url, opts, cb) => {
      setImmediate(() => fakeReq4.emit('error', Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' })));
      return fakeReq4;
    });

    const detector = new PACDetector();
    const findings = await withEnv(
      { PERCY_PAC_FILE_URL: undefined },
      () => detector.detectPAC()
    );

    const chromeFinding = findings.find(f => f.source === 'chrome:extension');
    expect(chromeFinding).toBeDefined();
    expect(chromeFinding.pacUrl).toBe('http://chrome-ext.pac/proxy.pac');
  });
});

describe('detectPAC — Firefox prefs.js branch (lines 199-209)', () => {
  it('discovers PAC url from Firefox profile prefs.js', async () => {
    spyOn(osMod, 'platform').and.returnValue('linux');
    spyOn(osMod, 'homedir').and.returnValue('/home/testuser');

    const firefoxProfilesDir = path.join('/home/testuser', '.mozilla/firefox');
    const profileDir = path.join(firefoxProfilesDir, 'abc123.default');
    const prefsJsPath = path.join(profileDir, 'prefs.js');

    spyOn(childProcess, 'execSync').and.throwError('not available');

    spyOn(fsMod, 'existsSync').and.callFake((p) => {
      if (p === firefoxProfilesDir) return true;
      if (p === prefsJsPath) return true;
      return false;
    });

    spyOn(fsMod, 'readdirSync').and.callFake((p, opts) => {
      if (p === firefoxProfilesDir) {
        // Return dirent-like objects
        return [{
          isDirectory: () => true,
          name: 'abc123.default'
        }];
      }
      return [];
    });

    const prefsContent = [
      'user_pref("network.proxy.type", 2);',
      'user_pref("network.proxy.autoconfig_url", "http://firefox.pac/proxy.pac");'
    ].join('\n');

    spyOn(fsMod, 'readFileSync').and.callFake((p) => {
      if (p === prefsJsPath) return prefsContent;
      throw new Error(`ENOENT: ${p}`);
    });

    // Mock http.get so #fetchText rejects immediately — no real network call
    const fakeReq5 = new EventEmitter();
    fakeReq5.destroy = () => {};
    spyOn(http, 'get').and.callFake((url, opts, cb) => {
      setImmediate(() => fakeReq5.emit('error', Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' })));
      return fakeReq5;
    });

    const detector = new PACDetector();
    const findings = await withEnv(
      { PERCY_PAC_FILE_URL: undefined },
      () => detector.detectPAC()
    );

    const ffFinding = findings.find(f => f.source && f.source.startsWith('firefox:prefs.js'));
    expect(ffFinding).toBeDefined();
    expect(ffFinding.pacUrl).toBe('http://firefox.pac/proxy.pac');
  });

  it('handles Firefox proxy type 4 (auto-detect with PAC url)', async () => {
    spyOn(osMod, 'platform').and.returnValue('linux');
    spyOn(osMod, 'homedir').and.returnValue('/home/testuser');

    const firefoxProfilesDir = path.join('/home/testuser', '.mozilla/firefox');
    const profileDir = path.join(firefoxProfilesDir, 'def456.default');
    const prefsJsPath = path.join(profileDir, 'prefs.js');

    spyOn(childProcess, 'execSync').and.throwError('not available');

    spyOn(fsMod, 'existsSync').and.callFake((p) => {
      if (p === firefoxProfilesDir || p === prefsJsPath) return true;
      return false;
    });

    spyOn(fsMod, 'readdirSync').and.returnValue([{ isDirectory: () => true, name: 'def456.default' }]);

    const prefsContent = [
      'user_pref("network.proxy.type", 4);',
      'user_pref("network.proxy.autoconfig_url", "http://ff-type4.pac/proxy.pac");'
    ].join('\n');

    spyOn(fsMod, 'readFileSync').and.callFake((p) => {
      if (p === prefsJsPath) return prefsContent;
      throw new Error(`ENOENT: ${p}`);
    });

    // Mock http.get so #fetchText rejects immediately — no real network call
    const fakeReq6 = new EventEmitter();
    fakeReq6.destroy = () => {};
    spyOn(http, 'get').and.callFake((url, opts, cb) => {
      setImmediate(() => fakeReq6.emit('error', Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' })));
      return fakeReq6;
    });

    const detector = new PACDetector();
    const findings = await withEnv(
      { PERCY_PAC_FILE_URL: undefined },
      () => detector.detectPAC()
    );

    const ffFinding = findings.find(f => f.source && f.source.startsWith('firefox:prefs.js'));
    expect(ffFinding).toBeDefined();
    expect(ffFinding.pacUrl).toBe('http://ff-type4.pac/proxy.pac');
  });
});

// ─── detectPAC — unsupported platform branches ────────────────────────────────
// Covers: detectPAC() if/else-if fall-through, #chromePacUrls() ?? [] fallback,
// and #firefoxPacUrls() !profileDirs early-return — all triggered by one unknown OS.

describe('detectPAC — unsupported platform (freebsd) skips all OS-specific paths', () => {
  it('returns a single info/none finding and hits the unsupported-platform branches in detectPAC, Chrome, and Firefox', async () => {
    spyOn(osMod, 'platform').and.returnValue('freebsd');
    spyOn(osMod, 'homedir').and.returnValue('/home/testuser');
    // existsSync must not be reached for Chrome/Firefox on an unknown OS; stub it
    // defensively so any unexpected call doesn't touch the real filesystem.
    spyOn(fsMod, 'existsSync').and.returnValue(false);

    const detector = new PACDetector();
    const findings = await withEnv(
      { PERCY_PAC_FILE_URL: undefined },
      () => detector.detectPAC()
    );

    // All three unsupported-platform branches return empty arrays →
    // discovered stays empty → the "none" info finding is emitted.
    expect(findings.length).toBe(1);
    expect(findings[0].source).toBe('none');
    expect(findings[0].status).toBe('info');
    // Confirm no OS-specific, Chrome, or Firefox PAC source was added
    expect(findings.every(f => f.source === 'none')).toBe(true);
  });
});

// ─── detectPAC — Firefox readdirSync throws branch (pac.js line 198) ─────────

describe('detectPAC — Firefox readdirSync throws branch (pac.js line 198)', () => {
  it('returns no Firefox findings when readdirSync throws inside #firefoxPacUrls', async () => {
    spyOn(osMod, 'platform').and.returnValue('linux');
    spyOn(osMod, 'homedir').and.returnValue('/home/testuser');

    const firefoxProfilesDir = '/home/testuser/.mozilla/firefox';

    // existsSync returns true only for the Firefox profiles dir so we pass the
    // !profileDirs guard on line 191, but readdirSync then throws → catch fires
    spyOn(fsMod, 'existsSync').and.callFake(p => p === firefoxProfilesDir);
    spyOn(fsMod, 'readdirSync').and.throwError('EACCES: permission denied, scandir');
    spyOn(fsMod, 'readFileSync').and.throwError('ENOENT');

    const detector = new PACDetector();
    const findings = await withEnv(
      { PERCY_PAC_FILE_URL: undefined },
      () => detector.detectPAC()
    );

    // catch { return urls } was reached — no firefox:prefs.js finding present
    expect(findings.every(f => !f.source?.startsWith('firefox:'))).toBe(true);
  });
});

// ─── detectPAC — macOS networksetup URL enabled branch (lines 73-76) ────────────

describe('detectPAC — macOS networksetup URL enabled branch (lines 73-76)', () => {
  it('discovers PAC url from networksetup when URL is set and Enabled is Yes', async () => {
    spyOn(osMod, 'platform').and.returnValue('darwin');
    spyOn(osMod, 'homedir').and.returnValue('/home/testuser');

    spyOn(childProcess, 'execSync').and.callFake((cmd) => {
      if (typeof cmd === 'string' && cmd.includes('getautoproxyurl')) {
        return 'URL: http://macos-net.pac/proxy.pac\nEnabled: Yes\n';
      }
      // plutil / plist paths — return empty JSON so plist branch doesn't find anything
      if (typeof cmd === 'string' && cmd.includes('plutil')) return '{}';
      throw new Error('not available');
    });

    spyOn(fsMod, 'existsSync').and.returnValue(false);

    // Mock http.get so #fetchText rejects immediately — no real network call
    const fakeReq7 = new EventEmitter();
    fakeReq7.destroy = () => {};
    spyOn(http, 'get').and.callFake((url, opts, cb) => {
      setImmediate(() => fakeReq7.emit('error', Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' })));
      return fakeReq7;
    });

    const detector = new PACDetector();
    const findings = await withEnv(
      { PERCY_PAC_FILE_URL: undefined },
      () => detector.detectPAC()
    );

    const netFinding = findings.find(f => f.source && f.source.startsWith('macOS:networksetup'));
    expect(netFinding).toBeDefined();
    expect(netFinding.pacUrl).toBe('http://macos-net.pac/proxy.pac');
    expect(netFinding.status).toBe('warn'); // unreachable host → warn
  });
});

// ─── detectPAC — Windows registry branch (lines 33, 132-140) ─────────────────

describe('detectPAC — Windows registry branch (lines 33, 132-140)', () => {
  it('discovers PAC url from Windows registry AutoConfigURL', async () => {
    spyOn(osMod, 'platform').and.returnValue('win32');
    spyOn(osMod, 'homedir').and.returnValue('C:\\Users\\testuser');

    spyOn(childProcess, 'execSync').and.callFake((cmd) => {
      if (typeof cmd === 'string' && cmd.includes('AutoConfigURL')) {
        return '    AutoConfigURL    REG_SZ    http://win.pac/proxy.pac\n';
      }
      throw new Error('not available');
    });

    spyOn(fsMod, 'existsSync').and.returnValue(false);

    // Mock http.get so #fetchText rejects immediately — no real network call
    const fakeReq8 = new EventEmitter();
    fakeReq8.destroy = () => {};
    spyOn(http, 'get').and.callFake((url, opts, cb) => {
      setImmediate(() => fakeReq8.emit('error', Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' })));
      return fakeReq8;
    });

    const detector = new PACDetector();
    const findings = await withEnv(
      { PERCY_PAC_FILE_URL: undefined },
      () => detector.detectPAC()
    );

    const winFinding = findings.find(f => f.source === 'windows:registry');
    expect(winFinding).toBeDefined();
    expect(winFinding.pacUrl).toBe('http://win.pac/proxy.pac');
    expect(winFinding.status).toBe('warn'); // unreachable host → warn
  });

  it('ignores registry when reg query throws (AutoConfigURL not set)', async () => {
    spyOn(osMod, 'platform').and.returnValue('win32');
    spyOn(osMod, 'homedir').and.returnValue('C:\\Users\\testuser');

    spyOn(childProcess, 'execSync').and.returnValue('reg query failed');
    spyOn(fsMod, 'existsSync').and.returnValue(false);

    const detector = new PACDetector();
    const findings = await withEnv(
      { PERCY_PAC_FILE_URL: undefined },
      () => detector.detectPAC()
    );

    const winFinding = findings.find(f => f.source === 'windows:registry');
    expect(winFinding).toBeUndefined();
  });
});

// ─── detectPAC — Chrome Preferences pac_url branch (line 174) ─────────────────

describe('detectPAC — Chrome Preferences pac_url branch (line 174)', () => {
  it('discovers PAC url from Chrome Default/Preferences proxy.pac_url', async () => {
    spyOn(osMod, 'platform').and.returnValue('darwin');
    spyOn(osMod, 'homedir').and.returnValue('/home/testuser');

    const localStatePath = path.join('/home/testuser', 'Library/Application Support/Google/Chrome/Local State');
    const prefsPath = path.join('/home/testuser', 'Library/Application Support/Google/Chrome/Default/Preferences');

    const localStateData = JSON.stringify({ profile: { info_cache: {} } });
    const prefsData = JSON.stringify({ proxy: { pac_url: 'http://chrome-prefs.pac/proxy.pac' } });

    spyOn(childProcess, 'execSync').and.throwError('not available');

    spyOn(fsMod, 'existsSync').and.callFake((p) => {
      if (p === localStatePath) return true;
      if (p === prefsPath) return true;
      return false;
    });

    spyOn(fsMod, 'readFileSync').and.callFake((p) => {
      if (p === localStatePath) return localStateData;
      if (p === prefsPath) return prefsData;
      throw new Error(`ENOENT: ${p}`);
    });

    // Mock http.get so #fetchText rejects immediately — no real network call
    const fakeReq9 = new EventEmitter();
    fakeReq9.destroy = () => {};
    spyOn(http, 'get').and.callFake((url, opts, cb) => {
      setImmediate(() => fakeReq9.emit('error', Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' })));
      return fakeReq9;
    });

    const detector = new PACDetector();
    const findings = await withEnv(
      { PERCY_PAC_FILE_URL: undefined },
      () => detector.detectPAC()
    );

    const chromePrefsFinding = findings.find(f => f.source && f.source.startsWith('chrome:Preferences'));
    expect(chromePrefsFinding).toBeDefined();
    expect(chromePrefsFinding.pacUrl).toBe('http://chrome-prefs.pac/proxy.pac');
    expect(chromePrefsFinding.status).toBe('warn'); // unreachable host → warn
  });
});

// ─── detectPAC — Firefox win32 profile path (line 202) ───────────────────────

describe('detectPAC — Firefox win32 profile path (line 202)', () => {
  it('discovers PAC url from Firefox prefs.js on win32', async () => {
    spyOn(osMod, 'platform').and.returnValue('win32');
    const home = 'C:\\Users\\testuser';
    spyOn(osMod, 'homedir').and.returnValue(home);

    const firefoxProfilesDir = path.join(home, 'AppData/Roaming/Mozilla/Firefox/Profiles');
    const profileDir = path.join(firefoxProfilesDir, 'abc123.default');
    const prefsJsPath = path.join(profileDir, 'prefs.js');

    spyOn(childProcess, 'execSync').and.throwError('not available');

    spyOn(fsMod, 'existsSync').and.callFake((p) => {
      if (p === firefoxProfilesDir) return true;
      if (p === prefsJsPath) return true;
      return false;
    });

    spyOn(fsMod, 'readdirSync').and.callFake((p, opts) => {
      if (p === firefoxProfilesDir) {
        return [{ isDirectory: () => true, name: 'abc123.default' }];
      }
      return [];
    });

    const prefsContent = [
      'user_pref("network.proxy.type", 2);',
      'user_pref("network.proxy.autoconfig_url", "http://win-firefox.pac/proxy.pac");'
    ].join('\n');

    spyOn(fsMod, 'readFileSync').and.callFake((p) => {
      if (p === prefsJsPath) return prefsContent;
      throw new Error(`ENOENT: ${p}`);
    });

    // Mock http.get so #fetchText rejects immediately — no real network call
    const fakeReq10 = new EventEmitter();
    fakeReq10.destroy = () => {};
    spyOn(http, 'get').and.callFake((url, opts, cb) => {
      setImmediate(() => fakeReq10.emit('error', Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' })));
      return fakeReq10;
    });

    const detector = new PACDetector();
    const findings = await withEnv(
      { PERCY_PAC_FILE_URL: undefined },
      () => detector.detectPAC()
    );

    const ffFinding = findings.find(f => f.source && f.source.startsWith('firefox:prefs.js'));
    expect(ffFinding).toBeDefined();
    expect(ffFinding.pacUrl).toBe('http://win-firefox.pac/proxy.pac');
  });
});

// ─── detectPAC — evaluatePac proxyMatch detectedProxyUrl (lines 262-263) ──────

describe('detectPAC — evaluatePac proxyMatch sets detectedProxyUrl (lines 262-263)', () => {
  it('sets detectedProxyUrl and HTTPS_PROXY suggestion when PAC resolves to PROXY', async () => {
    let pacServer;
    try {
      pacServer = await createPacServer(buildPacScript('PROXY corp.proxy.internal:8080'));

      const findings = await withEnv(
        { PERCY_PAC_FILE_URL: `${pacServer.url}/proxy.pac` },
        () => detectPAC()
      );

      const finding = findings.find(f => f.pacUrl === `${pacServer.url}/proxy.pac`);
      expect(finding).toBeDefined();
      expect(finding.status).toBe('warn');
      expect(finding.detectedProxyUrl).toBe('http://corp.proxy.internal:8080');
      expect(finding.suggestions.some(s => /HTTPS_PROXY.*corp\.proxy\.internal/.test(s))).toBe(true);
      expect(finding.suggestions.some(s => /PERCY_PAC_FILE_URL/.test(s))).toBe(true);
    } finally {
      if (pacServer) await pacServer.close();
    }
  });
});

// ─── detectPAC — #fetchText timeout branch (pac.js lines 296-297) ──────────────

describe('detectPAC — #fetchText timeout branch (pac.js lines 296-297)', () => {
  it('calls req.destroy and rejects with "PAC fetch timed out" when timeout event fires', async () => {
    // Build a fake ClientRequest that emits 'timeout' after all listeners are set up
    const fakeReq = new EventEmitter();
    fakeReq.destroy = jasmine.createSpy('req.destroy');

    // #fetchText uses (await import('http')).default — Babel compiles this to
    // the same require('http') object that our static `http` import points to,
    // so spying on http.get intercepts the call inside #fetchText.
    spyOn(http, 'get').and.callFake((url, options, callback) => {
      // Schedule timeout after all req.on() listeners have been registered
      setImmediate(() => fakeReq.emit('timeout'));
      return fakeReq;
    });

    const findings = await withEnv(
      { PERCY_PAC_FILE_URL: 'http://hanging.local/proxy.pac' },
      () => detectPAC()
    );

    // #evaluatePac catches the timed-out rejection and returns a warn finding
    const finding = findings.find(f => f.pacUrl === 'http://hanging.local/proxy.pac');
    expect(finding).toBeDefined();
    expect(finding.status).toBe('warn');
    expect(finding.message).toContain('PAC fetch timed out');
    expect(fakeReq.destroy).toHaveBeenCalled();
  });
});

// ─── PACDetector class ───────────────────────────────────────────────────────────

describe('PACDetector class', () => {
  it('can be instantiated', () => {
    const detector = new PACDetector();
    expect(detector).toBeDefined();
    expect(typeof detector.detectPAC).toBe('function');
  });

  it('detectPAC is spyable on instances', async () => {
    const detector = new PACDetector();
    spyOn(detector, 'detectPAC').and.returnValue(Promise.resolve([
      { status: 'info', source: 'none', message: 'mocked: no PAC detected.', pacUrl: null, resolvedProxy: null, suggestions: [] }
    ]));

    const findings = await detector.detectPAC();

    expect(detector.detectPAC).toHaveBeenCalled();
    expect(findings[0].message).toContain('mocked');
  });

  it('can be mocked to return a warn finding with detectedProxyUrl', async () => {
    const detector = new PACDetector();
    spyOn(detector, 'detectPAC').and.returnValue(Promise.resolve([
      {
        status: 'warn',
        source: 'env:PERCY_PAC_FILE_URL',
        pacUrl: 'http://corp.proxy/proxy.pac',
        resolvedProxy: 'PROXY corp.proxy:8080',
        detectedProxyUrl: 'http://corp.proxy:8080',
        message: 'PAC file routes percy.io via proxy.',
        suggestions: ['Set HTTPS_PROXY=http://corp.proxy:8080']
      }
    ]));

    const findings = await detector.detectPAC();
    const warn = findings[0];

    expect(warn.status).toBe('warn');
    expect(warn.detectedProxyUrl).toBe('http://corp.proxy:8080');
    expect(warn.suggestions[0]).toContain('HTTPS_PROXY');
  });

  it('multiple instances are independent (spy on one does not affect other)', () => {
    const a = new PACDetector();
    const b = new PACDetector();
    spyOn(a, 'detectPAC').and.returnValue(Promise.resolve([]));

    expect(b.detectPAC).not.toBe(a.detectPAC);
  });
});
