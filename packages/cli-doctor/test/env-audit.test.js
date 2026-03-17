/**
 * Tests for packages/cli-doctor/src/checks/env-audit.js
 *
 * checkEnvAndCI is the single combined entry point covering:
 *   PART A: system info (via @percy/monitoring) + Percy env-var audit
 *   PART B: CI detection (merged from former ci.js)
 *
 * Tests inject:
 *   - monitoringInstance  to control system-info output without real syscalls
 *   - percyEnv            to control CI detection without GITHUB_EVENT_PATH cache
 *
 * Uses withEnv to control process.env for env-audit assertions.
 */

import { checkEnvAndCI, checkEnvVars } from '../src/checks/env-audit.js';
import { withEnv } from './helpers.js';
import cp from 'child_process';

// ── Mock helpers ──────────────────────────────────────────────────────────────

/** Monitoring mock that skips real syscalls and returns null (no PERCY-DR-302). */
const nullMonitoring = {
  getPercyEnv: () => ({}),
  logSystemInfo: async () => null
};

/** Monitoring mock that returns a fixed system info object (emits PERCY-DR-302). */
const mockSystemInfo = {
  os: { platform: 'linux', type: 'Linux', release: '5.15.0' },
  cpu: { name: 'Intel Xeon', arch: 'x64', cores: 4 },
  disk: { available: '50 GB' },
  memory: { totalGb: 8.0, swapGb: 2.0 },
  containerInfo: { isContainer: false, isPod: false, isMachine: true },
  percyEnvs: {}
};

const systemMonitoring = {
  getPercyEnv: () => ({}),
  logSystemInfo: async () => mockSystemInfo
};

/** Monitoring mock whose logSystemInfo rejects (non-fatal path). */
const failingMonitoring = {
  getPercyEnv: () => ({}),
  logSystemInfo: async () => { throw new Error('systeminformation unavailable'); }
};

/** Not-in-CI PercyEnv mock. */
const noCI = { ci: null, commit: null, branch: null };

/** In-CI PercyEnv mock (GitHub Actions). */
function ciEnv({ commit = 'abc123def4567890', branch = 'main' } = {}) {
  return { ci: 'github', commit, branch };
}

// ── Base env that clears all Percy vars ───────────────────────────────────────
const CLEAN_PERCY_ENV = {
  PERCY_TOKEN: undefined,
  PERCY_BUILD_ID: undefined,
  PERCY_BUILD_URL: undefined,
  PERCY_BROWSER_EXECUTABLE: undefined,
  PERCY_CHROMIUM_BASE_URL: undefined,
  PERCY_PAC_FILE_URL: undefined,
  PERCY_CLIENT_API_URL: undefined,
  PERCY_SERVER_ADDRESS: undefined,
  PERCY_SERVER_HOST: undefined,
  PERCY_COMMIT: undefined,
  PERCY_BRANCH: undefined,
  PERCY_PULL_REQUEST: undefined,
  PERCY_TARGET_COMMIT: undefined,
  PERCY_TARGET_BRANCH: undefined,
  PERCY_PARALLEL_TOTAL: undefined,
  PERCY_PARALLEL_NONCE: undefined,
  PERCY_PARTIAL_BUILD: undefined,
  PERCY_AUTO_ENABLED_GROUP_BUILD: undefined,
  PERCY_DEBUG: undefined,
  PERCY_LOGLEVEL: undefined,
  PERCY_GZIP: undefined,
  PERCY_IGNORE_DUPLICATES: undefined,
  PERCY_IGNORE_TIMEOUT_ERROR: undefined,
  PERCY_SNAPSHOT_UPLOAD_CONCURRENCY: undefined,
  PERCY_RESOURCE_UPLOAD_CONCURRENCY: undefined,
  PERCY_NETWORK_IDLE_WAIT_TIMEOUT: undefined,
  PERCY_PAGE_LOAD_TIMEOUT: undefined,
  PERCY_DISABLE_SYSTEM_MONITORING: undefined,
  PERCY_METRICS: undefined,
  PERCY_SKIP_GIT_CHECK: undefined,
  PERCY_DISABLE_DOTENV: undefined,
  PERCY_EXIT_WITH_ZERO_ON_ERROR: undefined,
  PERCY_AUTO_DOCTOR: undefined,
  NODE_TLS_REJECT_UNAUTHORIZED: undefined
};

// Shorthand: run checkEnvAndCI with null monitoring + no-CI env injected
function run(envOverrides = {}, percyEnvOverride = noCI, monOverride = nullMonitoring) {
  return withEnv(envOverrides, () =>
    checkEnvAndCI({ monitoringInstance: monOverride, percyEnv: percyEnvOverride })
  );
}

// ── Backward-compat alias ────────────────────────────────────────────────────

describe('checkEnvVars alias', () => {
  it('checkEnvVars is the same function as checkEnvAndCI', () => {
    expect(checkEnvVars).toBe(checkEnvAndCI);
  });
});

// ── System info (PERCY-DR-302) ───────────────────────────────────────────────

describe('checkEnvAndCI — system info', () => {
  it('emits PERCY-DR-302 info when monitoring.logSystemInfo returns data', async () => {
    const findings = await withEnv(CLEAN_PERCY_ENV, () =>
      checkEnvAndCI({ monitoringInstance: systemMonitoring, percyEnv: noCI })
    );
    const f = findings.find(f => f.code === 'PERCY-DR-302');
    expect(f).toBeDefined();
    expect(f.status).toBe('info');
    expect(f.message).toContain('linux');
    expect(f.message).toContain('4 CPU core(s)');
    expect(f.message).toContain('8.0GB RAM');
    expect(f.metadata.cpu.cores).toBe(4);
    expect(f.metadata.memory.totalGb).toBe(8.0);
  });

  it('skips PERCY-DR-302 when monitoring.logSystemInfo returns null', async () => {
    const findings = await run(CLEAN_PERCY_ENV);
    expect(findings.find(f => f.code === 'PERCY-DR-302')).toBeUndefined();
  });

  it('skips PERCY-DR-302 when monitoring.logSystemInfo throws', async () => {
    const findings = await withEnv(CLEAN_PERCY_ENV, () =>
      checkEnvAndCI({ monitoringInstance: failingMonitoring, percyEnv: noCI })
    );
    expect(findings.find(f => f.code === 'PERCY-DR-302')).toBeUndefined();
    // Should still return env-audit findings
    expect(findings.find(f => f.code === 'PERCY-DR-300')).toBeDefined();
  });

  it('uses systemInfo.percyEnvs from logSystemInfo as the Percy env source', async () => {
    const monitoring = {
      getPercyEnv: () => ({ PERCY_GZIP: '1' }), // would be used as fallback
      logSystemInfo: async () => ({
        ...mockSystemInfo,
        percyEnvs: { PERCY_DEBUG: 'percy:*', PERCY_LOGLEVEL: 'debug' }
      })
    };
    const findings = await withEnv(CLEAN_PERCY_ENV, () =>
      checkEnvAndCI({ monitoringInstance: monitoring, percyEnv: noCI })
    );
    const listing = findings.find(f => f.code === 'PERCY-DR-301');
    expect(listing).toBeDefined();
    expect(listing.message).toContain('PERCY_DEBUG');
    expect(listing.message).toContain('PERCY_LOGLEVEL');
    // PERCY_GZIP was in getPercyEnv() but systemInfo.percyEnvs takes precedence
    expect(listing.message).not.toContain('PERCY_GZIP');
  });
});

// ── No Percy vars (PERCY-DR-300) ─────────────────────────────────────────────

describe('checkEnvAndCI — env var listing', () => {
  it('returns PERCY-DR-300 info when no Percy vars are set', async () => {
    const findings = await run(CLEAN_PERCY_ENV);
    const f = findings.find(f => f.code === 'PERCY-DR-300');
    expect(f).toBeDefined();
    expect(f.status).toBe('info');
    expect(f.message).toContain('No Percy-specific environment variables detected');
  });

  it('returns PERCY-DR-301 listing set vars', async () => {
    const findings = await run({ ...CLEAN_PERCY_ENV, PERCY_TOKEN: 'test', PERCY_DEBUG: 'true' });
    const f = findings.find(f => f.code === 'PERCY-DR-301');
    expect(f).toBeDefined();
    expect(f.status).toBe('info');
    expect(f.message).toContain('PERCY_TOKEN');
    expect(f.message).toContain('PERCY_DEBUG');
  });

  it('includes PERCY_AUTO_DOCTOR in listed vars', async () => {
    const findings = await run({ ...CLEAN_PERCY_ENV, PERCY_AUTO_DOCTOR: 'true' });
    const f = findings.find(f => f.code === 'PERCY-DR-301');
    expect(f).toBeDefined();
    expect(f.message).toContain('PERCY_AUTO_DOCTOR');
  });

  // ── PERCY_PARALLEL_TOTAL validation ────────────────────────────────────────

  it('returns PERCY-DR-303 fail when PERCY_PARALLEL_TOTAL is not a valid integer', async () => {
    const findings = await run({ ...CLEAN_PERCY_ENV, PERCY_PARALLEL_TOTAL: 'abc' });
    const f = findings.find(f => f.code === 'PERCY-DR-303');
    expect(f).toBeDefined();
    expect(f.status).toBe('fail');
    expect(f.message).toContain('PERCY_PARALLEL_TOTAL');
  });

  it('returns PERCY-DR-303 fail when PERCY_PARALLEL_TOTAL is zero', async () => {
    const findings = await run({ ...CLEAN_PERCY_ENV, PERCY_PARALLEL_TOTAL: '0' });
    expect(findings.find(f => f.code === 'PERCY-DR-303')).toBeDefined();
  });

  it('returns PERCY-DR-303 fail when PERCY_PARALLEL_TOTAL is negative', async () => {
    const findings = await run({ ...CLEAN_PERCY_ENV, PERCY_PARALLEL_TOTAL: '-3' });
    expect(findings.find(f => f.code === 'PERCY-DR-303')).toBeDefined();
  });

  it('returns PERCY-DR-303 fail when PERCY_PARALLEL_TOTAL is a float', async () => {
    const findings = await run({ ...CLEAN_PERCY_ENV, PERCY_PARALLEL_TOTAL: '4.5' });
    expect(findings.find(f => f.code === 'PERCY-DR-303')).toBeDefined();
  });

  it('does not fail when PERCY_PARALLEL_TOTAL is a valid positive integer', async () => {
    const findings = await run({ ...CLEAN_PERCY_ENV, PERCY_PARALLEL_TOTAL: '4' });
    expect(findings.find(f => f.code === 'PERCY-DR-303')).toBeUndefined();
  });

  // ── Manual overrides ────────────────────────────────────────────────────────

  it('returns PERCY-DR-304 info when manual overrides are active', async () => {
    const findings = await run({ ...CLEAN_PERCY_ENV, PERCY_COMMIT: 'abc123', PERCY_BRANCH: 'main' });
    const f = findings.find(f => f.code === 'PERCY-DR-304');
    expect(f).toBeDefined();
    expect(f.status).toBe('info');
    expect(f.message).toContain('PERCY_COMMIT');
    expect(f.message).toContain('PERCY_BRANCH');
    expect(f.message).toContain('Manual overrides');
  });

  it('does not warn about overrides when none are set', async () => {
    const findings = await run({ ...CLEAN_PERCY_ENV, PERCY_TOKEN: 'test' });
    expect(findings.find(f => f.code === 'PERCY-DR-304')).toBeUndefined();
  });

  // ── NODE_TLS_REJECT_UNAUTHORIZED ───────────────────────────────────────────

  it('returns PERCY-DR-305 warn when NODE_TLS_REJECT_UNAUTHORIZED=0', async () => {
    const findings = await run({ ...CLEAN_PERCY_ENV, NODE_TLS_REJECT_UNAUTHORIZED: '0' });
    const f = findings.find(f => f.code === 'PERCY-DR-305');
    expect(f).toBeDefined();
    expect(f.status).toBe('warn');
    expect(f.message).toContain('NODE_TLS_REJECT_UNAUTHORIZED=0');
    expect(f.suggestions.some(s => s.includes('NODE_EXTRA_CA_CERTS'))).toBe(true);
  });

  it('does not warn when NODE_TLS_REJECT_UNAUTHORIZED is 1', async () => {
    const findings = await run({ ...CLEAN_PERCY_ENV, NODE_TLS_REJECT_UNAUTHORIZED: '1' });
    expect(findings.find(f => f.code === 'PERCY-DR-305')).toBeUndefined();
  });

  it('does not warn when NODE_TLS_REJECT_UNAUTHORIZED is unset', async () => {
    const findings = await run({ ...CLEAN_PERCY_ENV, NODE_TLS_REJECT_UNAUTHORIZED: undefined });
    expect(findings.find(f => f.code === 'PERCY-DR-305')).toBeUndefined();
  });

  // ── SECURITY: no env var values in output ──────────────────────────────────

  it('never includes PERCY_TOKEN value in findings', async () => {
    const secret = 'web_my_super_secret_token_value';
    const findings = await run({ ...CLEAN_PERCY_ENV, PERCY_TOKEN: secret });
    const allText = findings.map(f =>
      `${f.message} ${(f.suggestions || []).join(' ')}`
    ).join(' ');
    expect(allText).not.toContain('my_super_secret');
    expect(allText).not.toContain('token_value');
    expect(allText).toContain('PERCY_TOKEN'); // name is fine
  });
});

// ── CI check (merged from ci.js) ─────────────────────────────────────────────

describe('checkEnvAndCI — CI section', () => {
  it('adds PERCY-DR-200 when not in CI and no CI check results follow', async () => {
    const findings = await run(CLEAN_PERCY_ENV, noCI);
    expect(findings.find(f => f.code === 'PERCY-DR-200')).toBeDefined();
    // CI-specific findings must not appear
    expect(findings.find(f => f.code === 'PERCY-DR-201')).toBeUndefined();
    expect(findings.find(f => f.code === 'PERCY-DR-202')).toBeUndefined();
  });

  it('adds PERCY-DR-201 when CI is detected', async () => {
    const findings = await run(CLEAN_PERCY_ENV, ciEnv());
    const f = findings.find(f => f.code === 'PERCY-DR-201');
    expect(f).toBeDefined();
    expect(f.status).toBe('pass');
    expect(f.message).toContain('github');
  });

  it('adds PERCY-DR-203 when commit is present', async () => {
    const findings = await run(CLEAN_PERCY_ENV, ciEnv({ commit: 'deadbeef1234' }));
    const f = findings.find(f => f.code === 'PERCY-DR-203');
    expect(f).toBeDefined();
    expect(f.message).toContain('deadbeef1234');
  });

  it('adds PERCY-DR-202 when commit is null', async () => {
    const findings = await run(CLEAN_PERCY_ENV, ciEnv({ commit: null }));
    expect(findings.find(f => f.code === 'PERCY-DR-202')).toBeDefined();
    expect(findings.find(f => f.code === 'PERCY-DR-203')).toBeUndefined();
  });

  it('adds PERCY-DR-204 when branch is null', async () => {
    const findings = await run(CLEAN_PERCY_ENV, ciEnv({ branch: null }));
    expect(findings.find(f => f.code === 'PERCY-DR-204')).toBeDefined();
  });

  it('combines env-audit findings with CI findings in one call', async () => {
    const findings = await run(
      { ...CLEAN_PERCY_ENV, PERCY_TOKEN: 'web_xxx', NODE_TLS_REJECT_UNAUTHORIZED: '0' },
      ciEnv()
    );
    // Env audit findings
    expect(findings.find(f => f.code === 'PERCY-DR-301')).toBeDefined(); // vars listed
    expect(findings.find(f => f.code === 'PERCY-DR-305')).toBeDefined(); // TLS warn
    // CI findings
    expect(findings.find(f => f.code === 'PERCY-DR-201')).toBeDefined(); // CI detected
    expect(findings.find(f => f.code === 'PERCY-DR-203')).toBeDefined(); // commit present
  });

  // ── Parallel config (DR-205 / DR-206) ──────────────────────────────────────

  it('adds PERCY-DR-205 warn when PERCY_PARALLEL_TOTAL is set without PERCY_PARALLEL_NONCE in CI', async () => {
    const findings = await run(
      { ...CLEAN_PERCY_ENV, PERCY_PARALLEL_TOTAL: '4', PERCY_PARALLEL_NONCE: undefined },
      ciEnv()
    );
    const warn = findings.find(f => f.code === 'PERCY-DR-205');
    expect(warn).toBeDefined();
    expect(warn.status).toBe('warn');
    expect(warn.message).toContain('PERCY_PARALLEL_NONCE');
    expect(findings.find(f => f.code === 'PERCY-DR-206')).toBeUndefined();
  });

  it('adds PERCY-DR-206 pass when both PERCY_PARALLEL_TOTAL and PERCY_PARALLEL_NONCE are set in CI', async () => {
    const findings = await run(
      { ...CLEAN_PERCY_ENV, PERCY_PARALLEL_TOTAL: '4', PERCY_PARALLEL_NONCE: 'build-42' },
      ciEnv()
    );
    const pass = findings.find(f => f.code === 'PERCY-DR-206');
    expect(pass).toBeDefined();
    expect(pass.status).toBe('pass');
    expect(pass.message).toContain('PERCY_PARALLEL_TOTAL');
    expect(pass.message).toContain('PERCY_PARALLEL_NONCE');
    expect(findings.find(f => f.code === 'PERCY-DR-205')).toBeUndefined();
  });

  // ── Git availability (DR-207 / DR-208 / DR-209) ────────────────────────────

  it('adds PERCY-DR-208 info when git is unavailable and PERCY_SKIP_GIT_CHECK=true', async () => {
    spyOn(cp, 'execSync').and.throwError('git: command not found');
    const findings = await run(
      { ...CLEAN_PERCY_ENV, PERCY_SKIP_GIT_CHECK: 'true' },
      ciEnv()
    );
    const info = findings.find(f => f.code === 'PERCY-DR-208');
    expect(info).toBeDefined();
    expect(info.status).toBe('info');
    expect(info.message).toContain('PERCY_SKIP_GIT_CHECK=true');
    expect(findings.find(f => f.code === 'PERCY-DR-207')).toBeUndefined();
    expect(findings.find(f => f.code === 'PERCY-DR-209')).toBeUndefined();
  });

  it('adds PERCY-DR-209 warn when git is unavailable and PERCY_SKIP_GIT_CHECK is not set', async () => {
    spyOn(cp, 'execSync').and.throwError('git: command not found');
    const findings = await run(
      { ...CLEAN_PERCY_ENV, PERCY_SKIP_GIT_CHECK: undefined },
      ciEnv()
    );
    const warn = findings.find(f => f.code === 'PERCY-DR-209');
    expect(warn).toBeDefined();
    expect(warn.status).toBe('warn');
    expect(warn.message).toContain('Git is not available');
    expect(findings.find(f => f.code === 'PERCY-DR-207')).toBeUndefined();
    expect(findings.find(f => f.code === 'PERCY-DR-208')).toBeUndefined();
  });
});
