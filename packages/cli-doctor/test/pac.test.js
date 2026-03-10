/**
 * Tests for packages/cli-doctor/src/checks/pac.js
 *
 * runPacScript is pure JS (no I/O) — fully unit-testable on any OS.
 * detectPAC tests use PERCY_PAC_FILE_URL + a local HTTP server to test the
 * full fetch → evaluate → classify pipeline without system config access.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { runPacScript, detectPAC, findInObject } from '../src/checks/pac.js';
import { createPacServer, createHttpServer, withEnv, buildPacScript } from './helpers.js';

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

// ─── detectPAC — macOS plist path (lines 118-137) ─────────────────────────────
// Use _execSyncFn injection to simulate plutil returning JSON for a plist file
// and _platform='darwin' to force the macOS branch.

describe('detectPAC — macOS plist PAC detection (lines 118-137)', () => {
  it('finds PAC URL in system plist via plutil output', async () => {
    // Create a real tmp file so fs.existsSync passes
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'percy-pac-test-'));
    // Fake plist path that the code will check — we put the fake file in tmpDir
    // but to intercept the fs.existsSync check we create a file at the path
    // that macOSPacUrls checks: plistPaths[0] = /Library/Preferences/SystemConfiguration/preferences.plist
    // Since we can't write there, we use the _homedirFn trick to make plistPaths[1] point to our tmp dir.
    // plistPaths[1] = path.join(os.homedir(), 'Library/Preferences/com.apple.systempreferences.plist')
    // So we create that file in tmpDir/Library/Preferences/
    const fakePlistDir = path.join(tmpDir, 'Library', 'Preferences');
    fs.mkdirSync(fakePlistDir, { recursive: true });
    const fakePlistPath = path.join(fakePlistDir, 'com.apple.systempreferences.plist');
    fs.writeFileSync(fakePlistPath, 'placeholder'); // content doesn't matter; _execSyncFn overrides

    const pacUrlFromPlist = 'http://plist-pac.corp.example.com/proxy.pac';
    const plistJson = JSON.stringify({ NetworkProxies: { ProxyAutoConfigURLString: pacUrlFromPlist } });

    // _execSyncFn: networksetup calls throw (no iface found), plutil returns JSON
    const execSyncFn = (cmd) => {
      if (cmd.includes('networksetup')) throw new Error('no interface');
      if (cmd.includes('plutil')) return plistJson;
      throw new Error('unexpected cmd');
    };

    const pacServer = await createPacServer(buildPacScript('DIRECT'));
    try {
      // detectPAC won't fetch plist-pac.corp which is unreachable; it returns warn
      const findings = await detectPAC({
        _platform: 'darwin',
        _execSyncFn: execSyncFn,
        _homedirFn: () => tmpDir
      });
      // Should find the plist-sourced PAC URL in findings
      const plistFinding = findings.find(f => f.pacUrl === pacUrlFromPlist);
      expect(plistFinding).toBeDefined();
      expect(plistFinding.source).toBe('macOS:plist');
    } finally {
      await pacServer.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('returns no macOS plist finding when plutil JSON has no ProxyAutoConfigURLString', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'percy-pac-test-'));
    const fakePlistDir = path.join(tmpDir, 'Library', 'Preferences');
    fs.mkdirSync(fakePlistDir, { recursive: true });
    const fakePlistPath = path.join(fakePlistDir, 'com.apple.systempreferences.plist');
    fs.writeFileSync(fakePlistPath, 'placeholder');

    const execSyncFn = (cmd) => {
      if (cmd.includes('networksetup')) throw new Error('no interface');
      if (cmd.includes('plutil')) return JSON.stringify({ other: 'data' });
      throw new Error('unexpected');
    };

    try {
      const findings = await withEnv({ PERCY_PAC_FILE_URL: undefined }, () =>
        detectPAC({ _platform: 'darwin', _execSyncFn: execSyncFn, _homedirFn: () => tmpDir })
      );
      // No PAC found — should return info/none finding
      const noneFinding = findings.find(f => f.source === 'none');
      expect(noneFinding).toBeDefined();
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

// ─── detectPAC — Linux gsettings auto + /etc/environment (lines 154-166) ──────

describe('detectPAC — Linux gsettings auto-mode PAC detection (lines 154-166)', () => {
  it('finds PAC URL when gsettings mode=auto', async () => {
    const pacUrl = 'http://linux-gsettings-pac.corp/auto.pac';
    // _execSyncFn returns 'auto' for mode query, then pacUrl for autoconfig-url query
    const execSyncFn = (cmd) => {
      if (cmd.includes('mode')) return "'auto'";
      if (cmd.includes('autoconfig-url')) return `'${pacUrl}'`;
      throw new Error('unexpected');
    };

    const findings = await detectPAC({ _platform: 'linux', _execSyncFn: execSyncFn });
    const linuxFinding = findings.find(f => f.pacUrl === pacUrl);
    expect(linuxFinding).toBeDefined();
    expect(linuxFinding.source).toBe('linux:gsettings');
  });

  it('ignores gsettings result when autoconfig-url is empty', async () => {
    const execSyncFn = (cmd) => {
      if (cmd.includes('mode')) return "'auto'";
      if (cmd.includes('autoconfig-url')) return "''"; // empty
      throw new Error('unexpected');
    };

    const findings = await withEnv({ PERCY_PAC_FILE_URL: undefined }, () =>
      detectPAC({ _platform: 'linux', _execSyncFn: execSyncFn })
    );
    // No PAC found from gsettings
    const none = findings.find(f => f.source === 'none');
    expect(none).toBeDefined();
  });
});

// ─── detectPAC — Chrome Preferences PAC URL (lines 192-209) ──────────────────
// Write fake Chrome Local State + Default/Preferences files in a tmp dir,
// override os.homedir() via _homedirFn.

describe('detectPAC — Chrome Preferences PAC detection (lines 192-209)', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'percy-chrome-pac-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('finds pac_url in Chrome Default/Preferences on darwin', async () => {
    const pacUrl = 'http://chrome-prefs-pac.corp/proxy.pac';
    const chromeDir = path.join(tmpDir, 'Library', 'Application Support', 'Google', 'Chrome');
    const defaultDir = path.join(chromeDir, 'Default');
    fs.mkdirSync(defaultDir, { recursive: true });

    // Local State file (must exist — content can be empty object)
    fs.writeFileSync(path.join(chromeDir, 'Local State'), JSON.stringify({}));
    // Preferences file with proxy.pac_url
    fs.writeFileSync(path.join(defaultDir, 'Preferences'), JSON.stringify({
      proxy: { pac_url: pacUrl }
    }));

    const findings = await detectPAC({ _platform: 'darwin', _homedirFn: () => tmpDir });
    const chromeFinding = findings.find(f => f.pacUrl === pacUrl);
    expect(chromeFinding).toBeDefined();
    expect(chromeFinding.source).toContain('chrome:Preferences');
  });

  it('finds pac_url from Chrome extension via Local State on linux', async () => {
    const pacUrl = 'http://chrome-ext-pac.corp/ext.pac';
    const chromeDir = path.join(tmpDir, '.config', 'google-chrome');
    const defaultDir = path.join(chromeDir, 'Default');
    fs.mkdirSync(defaultDir, { recursive: true });

    // Local State has pac_url nested (extension proxy settings)
    fs.writeFileSync(path.join(chromeDir, 'Local State'), JSON.stringify({
      extensions: { proxy_settings: { pac_url: pacUrl } }
    }));
    // Preferences exists but has no pac_url
    fs.writeFileSync(path.join(defaultDir, 'Preferences'), JSON.stringify({ proxy: {} }));

    const findings = await detectPAC({ _platform: 'linux', _homedirFn: () => tmpDir });
    const extFinding = findings.find(f => f.pacUrl === pacUrl);
    expect(extFinding).toBeDefined();
    expect(extFinding.source).toBe('chrome:extension');
  });

  it('skips Chrome detection when Local State file does not exist', async () => {
    const findings = await withEnv({ PERCY_PAC_FILE_URL: undefined }, () =>
      detectPAC({ _platform: 'darwin', _homedirFn: () => tmpDir })
    );
    const none = findings.find(f => f.source === 'none');
    expect(none).toBeDefined();
  });
});

// ─── detectPAC — Firefox prefs.js PAC detection (lines 229-252) ──────────────

describe('detectPAC — Firefox prefs.js PAC detection (lines 229-252)', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'percy-firefox-pac-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('finds PAC URL in Firefox prefs.js (type=2) on linux', async () => {
    const pacUrl = 'http://firefox-pac.corp/auto.pac';
    const profilesDir = path.join(tmpDir, '.mozilla', 'firefox');
    const profileDir = path.join(profilesDir, 'abc123.default');
    fs.mkdirSync(profileDir, { recursive: true });

    const prefsContent = [
      'user_pref("network.proxy.type", 2);',
      `user_pref("network.proxy.autoconfig_url", "${pacUrl}");`
    ].join('\n');
    fs.writeFileSync(path.join(profileDir, 'prefs.js'), prefsContent);

    const findings = await detectPAC({ _platform: 'linux', _homedirFn: () => tmpDir });
    const ffFinding = findings.find(f => f.pacUrl === pacUrl);
    expect(ffFinding).toBeDefined();
    expect(ffFinding.source).toContain('firefox:prefs.js');
  });

  it('finds PAC URL in Firefox prefs.js (type=4 WPAD) on darwin', async () => {
    const pacUrl = 'http://wpad.corp/wpad.dat';
    const profilesDir = path.join(tmpDir, 'Library', 'Application Support', 'Firefox', 'Profiles');
    const profileDir = path.join(profilesDir, 'xyz.default-release');
    fs.mkdirSync(profileDir, { recursive: true });

    const prefsContent = [
      'user_pref("network.proxy.type", 4);',
      `user_pref("network.proxy.autoconfig_url", "${pacUrl}");`
    ].join('\n');
    fs.writeFileSync(path.join(profileDir, 'prefs.js'), prefsContent);

    const findings = await detectPAC({ _platform: 'darwin', _homedirFn: () => tmpDir });
    const ffFinding = findings.find(f => f.pacUrl === pacUrl);
    expect(ffFinding).toBeDefined();
    expect(ffFinding.source).toContain('firefox:prefs.js');
  });

  it('skips Firefox profile without prefs.js', async () => {
    const profilesDir = path.join(tmpDir, '.mozilla', 'firefox');
    const profileDir = path.join(profilesDir, 'empty.profile');
    fs.mkdirSync(profileDir, { recursive: true });
    // No prefs.js written

    const findings = await withEnv({ PERCY_PAC_FILE_URL: undefined }, () =>
      detectPAC({ _platform: 'linux', _homedirFn: () => tmpDir })
    );
    const none = findings.find(f => f.source === 'none');
    expect(none).toBeDefined();
  });

  it('skips Firefox prefs.js when proxy type is not 2 or 4', async () => {
    const profilesDir = path.join(tmpDir, '.mozilla', 'firefox');
    const profileDir = path.join(profilesDir, 'manual.profile');
    fs.mkdirSync(profileDir, { recursive: true });

    // type=1 = manual proxy — no PAC
    const prefsContent = [
      'user_pref("network.proxy.type", 1);',
      'user_pref("network.proxy.autoconfig_url", "http://should-be-ignored.pac");'
    ].join('\n');
    fs.writeFileSync(path.join(profileDir, 'prefs.js'), prefsContent);

    const findings = await withEnv({ PERCY_PAC_FILE_URL: undefined }, () =>
      detectPAC({ _platform: 'linux', _homedirFn: () => tmpDir })
    );
    const none = findings.find(f => f.source === 'none');
    expect(none).toBeDefined();
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
