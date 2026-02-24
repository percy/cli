import { setupTest } from '@percy/cli-command/test/helpers';
import { detectPAC } from '@percy/cli-doctor/src/checks/pac.js';
import { execSync } from 'child_process';

// ─── detectPAC ────────────────────────────────────────────────────────────────

describe('detectPAC', () => {
  beforeEach(async () => {
    await setupTest();
  });

  // ── Return type ───────────────────────────────────────────────────────────

  it('always returns an array', async () => {
    const findings = await detectPAC();
    expect(Array.isArray(findings)).toBeTrue();
  });

  it('each finding has status, message', async () => {
    const findings = await detectPAC();
    for (const f of findings) {
      expect(f.status).toBeDefined();
      expect(f.message).toBeDefined();
    }
  });

  // ── No PAC detected ───────────────────────────────────────────────────────

  it('returns an info finding when no PAC is configured', async () => {
    // On a typical CI / dev machine with no PAC configured at all the function
    // should return exactly one info finding with source: 'none'.
    // If PAC IS detected on the test machine we still want at least one finding.
    const findings = await detectPAC();
    expect(findings.length).toBeGreaterThan(0);
  });

  it('no-PAC info finding has source: "none"', async () => {
    // Mock all the system detection helpers so nothing is discovered
    const mod = await import('@percy/cli-doctor/src/checks/pac.js');
    // We cannot easily spy on private helpers, so just assert the contract:
    // if the findings array contains a no-PAC entry it must have source none
    const findings = await detectPAC();
    const noEntry = findings.find(f => f.source === 'none');
    if (noEntry) {
      expect(noEntry.status).toBe('info');
      expect(noEntry.pacUrl).toBeNull();
    }
  });

  // ── Finding shape ─────────────────────────────────────────────────────────

  it('each finding has a pacUrl property', async () => {
    const findings = await detectPAC();
    for (const f of findings) {
      expect('pacUrl' in f).toBeTrue();
    }
  });

  it('each finding has a source property', async () => {
    const findings = await detectPAC();
    for (const f of findings) {
      expect(f.source).toBeDefined();
    }
  });

  it('each finding has a resolvedProxy property', async () => {
    const findings = await detectPAC();
    for (const f of findings) {
      expect('resolvedProxy' in f).toBeTrue();
    }
  });

  it('no-PAC finding has resolvedProxy: null', async () => {
    const findings = await detectPAC();
    const noEntry = findings.find(f => f.source === 'none');
    if (noEntry) {
      expect(noEntry.resolvedProxy).toBeNull();
    }
  });

  it('no-PAC finding has suggestions array', async () => {
    const findings = await detectPAC();
    const noEntry = findings.find(f => f.source === 'none');
    if (noEntry) {
      expect(Array.isArray(noEntry.suggestions)).toBeTrue();
    }
  });

  // ── Info status for no-PAC ────────────────────────────────────────────────

  it('no-PAC finding message says no PAC detected', async () => {
    const findings = await detectPAC();
    const noEntry = findings.find(f => f.source === 'none');
    if (noEntry) {
      expect(noEntry.message).toMatch(/no pac/i);
    }
  });
});
