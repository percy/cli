/**
 * Tests for packages/cli-doctor/src/checks/config.js
 *
 * Injects a mock searchFn to simulate various config scenarios.
 * No file system access required.
 */

import { checkConfig } from '../src/checks/config.js';
import { withEnv } from './helpers.js';

// Helper to create a searchFn that returns a fixed value
function mockSearch(returnValue) {
  return () => returnValue;
}

// Helper to create a searchFn that throws
function throwingSearch(message) {
  return () => { throw new Error(message); };
}

describe('checkConfig', () => {
  // ── No config file ──────────────────────────────────────────────────────────

  it('returns PERCY-DR-100 info when no config file is found', async () => {
    const findings = await checkConfig({ searchFn: mockSearch(null) });
    expect(findings.length).toBe(1);
    expect(findings[0].code).toBe('PERCY-DR-100');
    expect(findings[0].status).toBe('info');
    expect(findings[0].message).toContain('No Percy configuration file detected');
  });

  it('returns PERCY-DR-100 info when search returns empty config', async () => {
    const findings = await checkConfig({ searchFn: mockSearch({ config: null, filepath: '' }) });
    expect(findings.length).toBe(1);
    expect(findings[0].code).toBe('PERCY-DR-100');
    expect(findings[0].status).toBe('info');
  });

  // ── Config load error ───────────────────────────────────────────────────────

  it('returns PERCY-DR-104 fail when config file has syntax errors', async () => {
    const findings = await checkConfig({
      searchFn: throwingSearch('YAML parse error: unexpected token at line 5')
    });
    expect(findings.length).toBe(1);
    expect(findings[0].code).toBe('PERCY-DR-104');
    expect(findings[0].status).toBe('fail');
    expect(findings[0].message).toContain('YAML parse error');
    expect(findings[0].suggestions).toBeDefined();
    expect(findings[0].suggestions.length).toBeGreaterThan(0);
  });

  // ── Config file found ───────────────────────────────────────────────────────

  it('returns PERCY-DR-101 pass when config file is found', async () => {
    const findings = await withEnv({ PERCY_TOKEN: undefined }, () =>
      checkConfig({
        searchFn: mockSearch({ config: { version: 2 }, filepath: '/project/.percy.yml' })
      })
    );
    expect(findings.length).toBe(1);
    expect(findings[0].code).toBe('PERCY-DR-101');
    expect(findings[0].status).toBe('pass');
    expect(findings[0].message).toContain('.percy.yml');
  });

  // ── Version validation ──────────────────────────────────────────────────────

  it('returns PERCY-DR-102 warn when version is missing', async () => {
    const findings = await withEnv({ PERCY_TOKEN: undefined }, () =>
      checkConfig({
        searchFn: mockSearch({ config: {}, filepath: '/project/.percy.yml' })
      })
    );
    const versionFinding = findings.find(f => f.code === 'PERCY-DR-102');
    expect(versionFinding).toBeDefined();
    expect(versionFinding.status).toBe('warn');
    expect(versionFinding.message).toContain('missing or invalid version');
  });

  it('returns PERCY-DR-102 warn when version is non-numeric', async () => {
    const findings = await withEnv({ PERCY_TOKEN: undefined }, () =>
      checkConfig({
        searchFn: mockSearch({ config: { version: 'abc' }, filepath: '/project/.percy.yml' })
      })
    );
    const versionFinding = findings.find(f => f.code === 'PERCY-DR-102');
    expect(versionFinding).toBeDefined();
    expect(versionFinding.status).toBe('warn');
  });

  it('returns PERCY-DR-103 warn when config uses version 1', async () => {
    const findings = await withEnv({ PERCY_TOKEN: undefined }, () =>
      checkConfig({
        searchFn: mockSearch({ config: { version: 1 }, filepath: '/project/.percy.yml' })
      })
    );
    const versionFinding = findings.find(f => f.code === 'PERCY-DR-103');
    expect(versionFinding).toBeDefined();
    expect(versionFinding.status).toBe('warn');
    expect(versionFinding.message).toContain('outdated format (version 1)');
    expect(versionFinding.suggestions).toContain('Run: percy config:migrate to update to the latest format.');
  });

  it('returns PERCY-DR-103 warn with correct version number for version 0', async () => {
    const findings = await withEnv({ PERCY_TOKEN: undefined }, () =>
      checkConfig({
        searchFn: mockSearch({ config: { version: 0 }, filepath: '/project/.percy.yml' })
      })
    );
    const versionFinding = findings.find(f => f.code === 'PERCY-DR-103');
    expect(versionFinding).toBeDefined();
    expect(versionFinding.message).toContain('outdated format (version 0)');
  });

  it('does not warn when config uses version 2', async () => {
    const findings = await withEnv({ PERCY_TOKEN: undefined }, () =>
      checkConfig({
        searchFn: mockSearch({ config: { version: 2 }, filepath: '/project/.percy.yml' })
      })
    );
    const versionWarns = findings.filter(f =>
      f.code === 'PERCY-DR-102' || f.code === 'PERCY-DR-103'
    );
    expect(versionWarns.length).toBe(0);
  });

  // ── Project-type config mismatches ──────────────────────────────────────────

  it('returns PERCY-DR-105 warn for automate-only keys with web token', async () => {
    const findings = await withEnv({ PERCY_TOKEN: 'web_abc123' }, () =>
      checkConfig({
        searchFn: mockSearch({
          config: { version: 2, snapshot: { fullPage: true, freezeAnimation: true } },
          filepath: '/project/.percy.yml'
        })
      })
    );
    const mismatch = findings.find(f => f.code === 'PERCY-DR-105');
    expect(mismatch).toBeDefined();
    expect(mismatch.status).toBe('warn');
    expect(mismatch.message).toContain('fullPage');
    expect(mismatch.message).toContain('freezeAnimation');
    expect(mismatch.message).toContain('web');
  });

  it('returns PERCY-DR-105 warn for automate-only keys with app token', async () => {
    const findings = await withEnv({ PERCY_TOKEN: 'app_abc123' }, () =>
      checkConfig({
        searchFn: mockSearch({
          config: { version: 2, snapshot: { ignoreRegions: [{ selector: '.ad' }] } },
          filepath: '/project/.percy.yml'
        })
      })
    );
    const mismatch = findings.find(f => f.code === 'PERCY-DR-105');
    expect(mismatch).toBeDefined();
    expect(mismatch.message).toContain('ignoreRegions');
    expect(mismatch.message).toContain('app');
  });

  it('does NOT return PERCY-DR-105 for automate-only keys with auto token', async () => {
    const findings = await withEnv({ PERCY_TOKEN: 'auto_abc123' }, () =>
      checkConfig({
        searchFn: mockSearch({
          config: { version: 2, snapshot: { fullPage: true } },
          filepath: '/project/.percy.yml'
        })
      })
    );
    const mismatch = findings.find(f => f.code === 'PERCY-DR-105');
    expect(mismatch).toBeUndefined();
  });

  it('returns PERCY-DR-106 warn for web-only keys with automate token', async () => {
    const findings = await withEnv({ PERCY_TOKEN: 'auto_abc123' }, () =>
      checkConfig({
        searchFn: mockSearch({
          config: { version: 2, snapshot: { waitForTimeout: 5000, waitForSelector: '.loaded' } },
          filepath: '/project/.percy.yml'
        })
      })
    );
    const mismatch = findings.find(f => f.code === 'PERCY-DR-106');
    expect(mismatch).toBeDefined();
    expect(mismatch.status).toBe('warn');
    expect(mismatch.message).toContain('waitForTimeout');
    expect(mismatch.message).toContain('waitForSelector');
    expect(mismatch.message).toContain('automate');
  });

  it('returns PERCY-DR-106 warn for web-only keys with app token', async () => {
    const findings = await withEnv({ PERCY_TOKEN: 'app_abc123' }, () =>
      checkConfig({
        searchFn: mockSearch({
          config: { version: 2, snapshot: { waitForTimeout: 3000 } },
          filepath: '/project/.percy.yml'
        })
      })
    );
    const mismatch = findings.find(f => f.code === 'PERCY-DR-106');
    expect(mismatch).toBeDefined();
    expect(mismatch.message).toContain('app');
  });

  it('does NOT return PERCY-DR-106 for web-only keys with web token', async () => {
    const findings = await withEnv({ PERCY_TOKEN: 'web_abc123' }, () =>
      checkConfig({
        searchFn: mockSearch({
          config: { version: 2, snapshot: { waitForTimeout: 5000 } },
          filepath: '/project/.percy.yml'
        })
      })
    );
    const mismatch = findings.find(f => f.code === 'PERCY-DR-106');
    expect(mismatch).toBeUndefined();
  });

  it('returns PERCY-DR-106 warn for web-only keys with ss_ (generic) token', async () => {
    const findings = await withEnv({ PERCY_TOKEN: 'ss_abc123' }, () =>
      checkConfig({
        searchFn: mockSearch({
          config: { version: 2, snapshot: { waitForTimeout: 5000 } },
          filepath: '/project/.percy.yml'
        })
      })
    );
    const mismatch = findings.find(f => f.code === 'PERCY-DR-106');
    expect(mismatch).toBeDefined();
    expect(mismatch.message).toContain('generic');
  });

  it('returns PERCY-DR-105 with correct type for ss_ (generic) token', async () => {
    const findings = await withEnv({ PERCY_TOKEN: 'ss_abc123' }, () =>
      checkConfig({
        searchFn: mockSearch({
          config: { version: 2, snapshot: { fullPage: true } },
          filepath: '/project/.percy.yml'
        })
      })
    );
    const mismatch = findings.find(f => f.code === 'PERCY-DR-105');
    expect(mismatch).toBeDefined();
    expect(mismatch.message).toContain('generic');
  });

  it('returns PERCY-DR-105 with correct type for vmw_ (visual_scanner) token', async () => {
    const findings = await withEnv({ PERCY_TOKEN: 'vmw_abc123' }, () =>
      checkConfig({
        searchFn: mockSearch({
          config: { version: 2, snapshot: { freezeAnimation: true } },
          filepath: '/project/.percy.yml'
        })
      })
    );
    const mismatch = findings.find(f => f.code === 'PERCY-DR-105');
    expect(mismatch).toBeDefined();
    expect(mismatch.message).toContain('visual_scanner');
  });

  it('returns PERCY-DR-105 with correct type for res_ (responsive_scanner) token', async () => {
    const findings = await withEnv({ PERCY_TOKEN: 'res_abc123' }, () =>
      checkConfig({
        searchFn: mockSearch({
          config: { version: 2, snapshot: { ignoreRegions: [{}] } },
          filepath: '/project/.percy.yml'
        })
      })
    );
    const mismatch = findings.find(f => f.code === 'PERCY-DR-105');
    expect(mismatch).toBeDefined();
    expect(mismatch.message).toContain('responsive_scanner');
  });

  // ── No mismatch when snapshot section is empty ─────────────────────────────

  it('skips mismatch checks when snapshot config is absent', async () => {
    const findings = await withEnv({ PERCY_TOKEN: 'web_abc123' }, () =>
      checkConfig({
        searchFn: mockSearch({ config: { version: 2 }, filepath: '/project/.percy.yml' })
      })
    );
    const mismatches = findings.filter(f =>
      f.code === 'PERCY-DR-105' || f.code === 'PERCY-DR-106'
    );
    expect(mismatches.length).toBe(0);
  });

  // ── Suggestions quality ────────────────────────────────────────────────────

  it('includes actionable suggestions for no config file', async () => {
    const findings = await checkConfig({ searchFn: mockSearch(null) });
    const suggestions = findings[0].suggestions;
    expect(suggestions).toBeDefined();
    expect(suggestions.some(s => s.includes('.percy.yml'))).toBe(true);
  });

  it('includes config:validate suggestion for load errors', async () => {
    const findings = await checkConfig({ searchFn: throwingSearch('bad yaml') });
    expect(findings[0].suggestions.some(s => s.includes('config:validate'))).toBe(true);
  });
});
