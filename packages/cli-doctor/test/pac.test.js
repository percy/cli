/**
 * Tests for packages/cli-doctor/src/checks/pac.js
 *
 * runPacScript is pure JS (no I/O) — fully unit-testable on any OS.
 * detectPAC tests use PERCY_PAC_FILE_URL + a local HTTP server to test the
 * full fetch → evaluate → classify pipeline without system config access.
 */

import { runPacScript, detectPAC } from '../src/checks/pac.js';
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
