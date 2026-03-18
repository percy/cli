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

  it('returns config_not_found info when no config file is found', async () => {
    const findings = await checkConfig({ searchFn: mockSearch(null) });
    expect(findings.length).toBe(1);
    expect(findings[0].category).toBe('config_not_found');
    expect(findings[0].status).toBe('info');
    expect(findings[0].message).toContain('No Percy configuration file detected');
  });

  it('returns config_not_found info when search returns empty config', async () => {
    const findings = await checkConfig({ searchFn: mockSearch({ config: null, filepath: '' }) });
    expect(findings.length).toBe(1);
    expect(findings[0].category).toBe('config_not_found');
    expect(findings[0].status).toBe('info');
  });

  // ── Config load error ───────────────────────────────────────────────────────

  it('returns config_parse_error fail when config file has syntax errors', async () => {
    const findings = await checkConfig({
      searchFn: throwingSearch('YAML parse error: unexpected token at line 5')
    });
    expect(findings.length).toBe(1);
    expect(findings[0].category).toBe('config_parse_error');
    expect(findings[0].status).toBe('fail');
    expect(findings[0].message).toContain('YAML parse error');
    expect(findings[0].suggestions).toBeDefined();
    expect(findings[0].suggestions.length).toBeGreaterThan(0);
  });

  // ── Config file found ───────────────────────────────────────────────────────

  it('returns config_found pass when config file is found', async () => {
    const findings = await withEnv({ PERCY_TOKEN: undefined }, () =>
      checkConfig({
        searchFn: mockSearch({ config: { version: 2 }, filepath: '/project/.percy.yml' })
      })
    );
    expect(findings.length).toBe(1);
    expect(findings[0].category).toBe('config_found');
    expect(findings[0].status).toBe('pass');
    expect(findings[0].message).toContain('.percy.yml');
  });

  // ── Version validation ──────────────────────────────────────────────────────

  it('returns config_version_invalid warn when version is missing', async () => {
    const findings = await withEnv({ PERCY_TOKEN: undefined }, () =>
      checkConfig({
        searchFn: mockSearch({ config: {}, filepath: '/project/.percy.yml' })
      })
    );
    const versionFinding = findings.find(f => f.category === 'config_version_invalid');
    expect(versionFinding).toBeDefined();
    expect(versionFinding.status).toBe('warn');
    expect(versionFinding.message).toContain('missing or invalid version');
  });

  it('returns config_version_invalid warn when version is non-numeric', async () => {
    const findings = await withEnv({ PERCY_TOKEN: undefined }, () =>
      checkConfig({
        searchFn: mockSearch({ config: { version: 'abc' }, filepath: '/project/.percy.yml' })
      })
    );
    const versionFinding = findings.find(f => f.category === 'config_version_invalid');
    expect(versionFinding).toBeDefined();
    expect(versionFinding.status).toBe('warn');
  });

  it('returns config_version_outdated warn when config uses version 1', async () => {
    const findings = await withEnv({ PERCY_TOKEN: undefined }, () =>
      checkConfig({
        searchFn: mockSearch({ config: { version: 1 }, filepath: '/project/.percy.yml' })
      })
    );
    const versionFinding = findings.find(f => f.category === 'config_version_outdated');
    expect(versionFinding).toBeDefined();
    expect(versionFinding.status).toBe('warn');
    expect(versionFinding.message).toContain('outdated format (version 1)');
    expect(versionFinding.suggestions).toContain('Run: percy config:migrate to update to the latest format.');
  });

  it('returns config_version_outdated warn with correct version number for version 0', async () => {
    const findings = await withEnv({ PERCY_TOKEN: undefined }, () =>
      checkConfig({
        searchFn: mockSearch({ config: { version: 0 }, filepath: '/project/.percy.yml' })
      })
    );
    const versionFinding = findings.find(f => f.category === 'config_version_outdated');
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
      f.category === 'config_version_invalid' || f.category === 'config_version_outdated'
    );
    expect(versionWarns.length).toBe(0);
  });

  // ── Project-type config mismatches ──────────────────────────────────────────

  it('returns config_key_automate_only warn for automate-only keys with web token', async () => {
    const findings = await withEnv({ PERCY_TOKEN: 'web_abc123' }, () =>
      checkConfig({
        searchFn: mockSearch({
          config: { version: 2, snapshot: { fullPage: true, freezeAnimation: true } },
          filepath: '/project/.percy.yml'
        })
      })
    );
    const mismatch = findings.find(f => f.category === 'config_key_automate_only');
    expect(mismatch).toBeDefined();
    expect(mismatch.status).toBe('warn');
    expect(mismatch.message).toContain('fullPage');
    expect(mismatch.message).toContain('freezeAnimation');
    expect(mismatch.message).toContain('web');
  });

  it('returns config_key_automate_only warn for automate-only keys with app token', async () => {
    const findings = await withEnv({ PERCY_TOKEN: 'app_abc123' }, () =>
      checkConfig({
        searchFn: mockSearch({
          config: { version: 2, snapshot: { ignoreRegions: [{ selector: '.ad' }] } },
          filepath: '/project/.percy.yml'
        })
      })
    );
    const mismatch = findings.find(f => f.category === 'config_key_automate_only');
    expect(mismatch).toBeDefined();
    expect(mismatch.message).toContain('ignoreRegions');
    expect(mismatch.message).toContain('app');
  });

  it('does NOT return config_key_automate_only for automate-only keys with auto token', async () => {
    const findings = await withEnv({ PERCY_TOKEN: 'auto_abc123' }, () =>
      checkConfig({
        searchFn: mockSearch({
          config: { version: 2, snapshot: { fullPage: true } },
          filepath: '/project/.percy.yml'
        })
      })
    );
    const mismatch = findings.find(f => f.category === 'config_key_automate_only');
    expect(mismatch).toBeUndefined();
  });

  it('returns config_key_web_only warn for web-only keys with automate token', async () => {
    const findings = await withEnv({ PERCY_TOKEN: 'auto_abc123' }, () =>
      checkConfig({
        searchFn: mockSearch({
          config: { version: 2, snapshot: { waitForTimeout: 5000, waitForSelector: '.loaded' } },
          filepath: '/project/.percy.yml'
        })
      })
    );
    const mismatch = findings.find(f => f.category === 'config_key_web_only');
    expect(mismatch).toBeDefined();
    expect(mismatch.status).toBe('warn');
    expect(mismatch.message).toContain('waitForTimeout');
    expect(mismatch.message).toContain('waitForSelector');
    expect(mismatch.message).toContain('automate');
  });

  it('returns config_key_web_only warn for web-only keys with app token', async () => {
    const findings = await withEnv({ PERCY_TOKEN: 'app_abc123' }, () =>
      checkConfig({
        searchFn: mockSearch({
          config: { version: 2, snapshot: { waitForTimeout: 3000 } },
          filepath: '/project/.percy.yml'
        })
      })
    );
    const mismatch = findings.find(f => f.category === 'config_key_web_only');
    expect(mismatch).toBeDefined();
    expect(mismatch.message).toContain('app');
  });

  it('does NOT return config_key_web_only for web-only keys with web token', async () => {
    const findings = await withEnv({ PERCY_TOKEN: 'web_abc123' }, () =>
      checkConfig({
        searchFn: mockSearch({
          config: { version: 2, snapshot: { waitForTimeout: 5000 } },
          filepath: '/project/.percy.yml'
        })
      })
    );
    const mismatch = findings.find(f => f.category === 'config_key_web_only');
    expect(mismatch).toBeUndefined();
  });

  it('returns config_key_web_only warn for web-only keys with ss_ (generic) token', async () => {
    const findings = await withEnv({ PERCY_TOKEN: 'ss_abc123' }, () =>
      checkConfig({
        searchFn: mockSearch({
          config: { version: 2, snapshot: { waitForTimeout: 5000 } },
          filepath: '/project/.percy.yml'
        })
      })
    );
    const mismatch = findings.find(f => f.category === 'config_key_web_only');
    expect(mismatch).toBeDefined();
    expect(mismatch.message).toContain('generic');
  });

  it('returns config_key_automate_only with correct type for ss_ (generic) token', async () => {
    const findings = await withEnv({ PERCY_TOKEN: 'ss_abc123' }, () =>
      checkConfig({
        searchFn: mockSearch({
          config: { version: 2, snapshot: { fullPage: true } },
          filepath: '/project/.percy.yml'
        })
      })
    );
    const mismatch = findings.find(f => f.category === 'config_key_automate_only');
    expect(mismatch).toBeDefined();
    expect(mismatch.message).toContain('generic');
  });

  it('returns config_key_automate_only with correct type for vmw_ (visual_scanner) token', async () => {
    const findings = await withEnv({ PERCY_TOKEN: 'vmw_abc123' }, () =>
      checkConfig({
        searchFn: mockSearch({
          config: { version: 2, snapshot: { freezeAnimation: true } },
          filepath: '/project/.percy.yml'
        })
      })
    );
    const mismatch = findings.find(f => f.category === 'config_key_automate_only');
    expect(mismatch).toBeDefined();
    expect(mismatch.message).toContain('visual_scanner');
  });

  it('returns config_key_automate_only with correct type for res_ (responsive_scanner) token', async () => {
    const findings = await withEnv({ PERCY_TOKEN: 'res_abc123' }, () =>
      checkConfig({
        searchFn: mockSearch({
          config: { version: 2, snapshot: { ignoreRegions: [{}] } },
          filepath: '/project/.percy.yml'
        })
      })
    );
    const mismatch = findings.find(f => f.category === 'config_key_automate_only');
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
      f.category === 'config_key_automate_only' || f.category === 'config_key_web_only'
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
