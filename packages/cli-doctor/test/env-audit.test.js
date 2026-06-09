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

import { checkEnvAndCI } from '../src/checks/env-audit.js';
import { withEnv } from './helpers.js';
import cp from 'child_process';

// ── Mock helpers ──────────────────────────────────────────────────────────────

/** Monitoring mock that skips real syscalls and returns null (no env_system_info). */
const nullMonitoring = {
  getPercyEnv: () => ({}),
  logSystemInfo: async () => null
};

/** Monitoring mock that returns a fixed system info object (emits env_system_info). */
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

// ── System info (env_system_info) ───────────────────────────────────────────────

describe('checkEnvAndCI — system info', () => {
  it('emits env_system_info info when monitoring.logSystemInfo returns data', async () => {
    const findings = await withEnv(CLEAN_PERCY_ENV, () =>
      checkEnvAndCI({ monitoringInstance: systemMonitoring, percyEnv: noCI })
    );
    const f = findings.find(f => f.category === 'env_system_info');
    expect(f).toBeDefined();
    expect(f.status).toBe('info');
    expect(f.message).toContain('linux');
    expect(f.message).toContain('4 CPU core(s)');
    expect(f.message).toContain('8.0GB RAM');
    expect(f.metadata.cpu.cores).toBe(4);
    expect(f.metadata.memory.totalGb).toBe(8.0);
  });

  it('skips env_system_info when monitoring.logSystemInfo returns null', async () => {
    const findings = await run(CLEAN_PERCY_ENV);
    expect(findings.find(f => f.category === 'env_system_info')).toBeUndefined();
  });

  it('skips env_system_info when monitoring.logSystemInfo throws', async () => {
    const findings = await withEnv(CLEAN_PERCY_ENV, () =>
      checkEnvAndCI({ monitoringInstance: failingMonitoring, percyEnv: noCI })
    );
    expect(findings.find(f => f.category === 'env_system_info')).toBeUndefined();
    // Should still return env-audit findings
    expect(findings.find(f => f.category === 'env_no_percy_vars')).toBeDefined();
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
    const listing = findings.find(f => f.category === 'env_vars_listed');
    expect(listing).toBeDefined();
    expect(listing.message).toContain('PERCY_DEBUG');
    expect(listing.message).toContain('PERCY_LOGLEVEL');
    // PERCY_GZIP was in getPercyEnv() but systemInfo.percyEnvs takes precedence
    expect(listing.message).not.toContain('PERCY_GZIP');
  });
});

// ── No Percy vars (env_no_percy_vars) ─────────────────────────────────────────────

describe('checkEnvAndCI — env var listing', () => {
  it('returns env_no_percy_vars info when no Percy vars are set', async () => {
    const findings = await run(CLEAN_PERCY_ENV);
    const f = findings.find(f => f.category === 'env_no_percy_vars');
    expect(f).toBeDefined();
    expect(f.status).toBe('info');
    expect(f.message).toContain('No Percy-specific environment variables detected');
  });

  it('returns env_vars_listed listing set vars', async () => {
    const findings = await run({ ...CLEAN_PERCY_ENV, PERCY_TOKEN: 'test', PERCY_DEBUG: 'true' });
    const f = findings.find(f => f.category === 'env_vars_listed');
    expect(f).toBeDefined();
    expect(f.status).toBe('info');
    expect(f.message).toContain('PERCY_TOKEN');
    expect(f.message).toContain('PERCY_DEBUG');
  });

  it('includes PERCY_AUTO_DOCTOR in listed vars', async () => {
    const findings = await run({ ...CLEAN_PERCY_ENV, PERCY_AUTO_DOCTOR: 'true' });
    const f = findings.find(f => f.category === 'env_vars_listed');
    expect(f).toBeDefined();
    expect(f.message).toContain('PERCY_AUTO_DOCTOR');
  });

  // ── PERCY_PARALLEL_TOTAL validation ────────────────────────────────────────

  it('returns env_parallel_total_invalid fail when PERCY_PARALLEL_TOTAL is not a valid integer', async () => {
    const findings = await run({ ...CLEAN_PERCY_ENV, PERCY_PARALLEL_TOTAL: 'abc' });
    const f = findings.find(f => f.category === 'env_parallel_total_invalid');
    expect(f).toBeDefined();
    expect(f.status).toBe('fail');
    expect(f.message).toContain('PERCY_PARALLEL_TOTAL');
  });

  it('returns env_parallel_total_invalid fail when PERCY_PARALLEL_TOTAL is zero', async () => {
    const findings = await run({ ...CLEAN_PERCY_ENV, PERCY_PARALLEL_TOTAL: '0' });
    expect(findings.find(f => f.category === 'env_parallel_total_invalid')).toBeDefined();
  });

  it('returns env_parallel_total_invalid fail when PERCY_PARALLEL_TOTAL is negative', async () => {
    const findings = await run({ ...CLEAN_PERCY_ENV, PERCY_PARALLEL_TOTAL: '-3' });
    expect(findings.find(f => f.category === 'env_parallel_total_invalid')).toBeDefined();
  });

  it('returns env_parallel_total_invalid fail when PERCY_PARALLEL_TOTAL is a float', async () => {
    const findings = await run({ ...CLEAN_PERCY_ENV, PERCY_PARALLEL_TOTAL: '4.5' });
    expect(findings.find(f => f.category === 'env_parallel_total_invalid')).toBeDefined();
  });

  it('does not fail when PERCY_PARALLEL_TOTAL is a valid positive integer', async () => {
    const findings = await run({ ...CLEAN_PERCY_ENV, PERCY_PARALLEL_TOTAL: '4' });
    expect(findings.find(f => f.category === 'env_parallel_total_invalid')).toBeUndefined();
  });

  // ── Manual overrides ────────────────────────────────────────────────────────

  it('returns env_manual_overrides info when manual overrides are active', async () => {
    const findings = await run({ ...CLEAN_PERCY_ENV, PERCY_COMMIT: 'abc123', PERCY_BRANCH: 'main' });
    const f = findings.find(f => f.category === 'env_manual_overrides');
    expect(f).toBeDefined();
    expect(f.status).toBe('info');
    expect(f.message).toContain('PERCY_COMMIT');
    expect(f.message).toContain('PERCY_BRANCH');
    expect(f.message).toContain('Manual overrides');
  });

  it('does not warn about overrides when none are set', async () => {
    const findings = await run({ ...CLEAN_PERCY_ENV, PERCY_TOKEN: 'test' });
    expect(findings.find(f => f.category === 'env_manual_overrides')).toBeUndefined();
  });

  // ── NODE_TLS_REJECT_UNAUTHORIZED ───────────────────────────────────────────

  it('returns env_tls_disabled warn when NODE_TLS_REJECT_UNAUTHORIZED=0', async () => {
    const findings = await run({ ...CLEAN_PERCY_ENV, NODE_TLS_REJECT_UNAUTHORIZED: '0' });
    const f = findings.find(f => f.category === 'env_tls_disabled');
    expect(f).toBeDefined();
    expect(f.status).toBe('warn');
    expect(f.message).toContain('NODE_TLS_REJECT_UNAUTHORIZED=0');
    expect(f.suggestions.some(s => s.includes('NODE_EXTRA_CA_CERTS'))).toBe(true);
  });

  it('does not warn when NODE_TLS_REJECT_UNAUTHORIZED is 1', async () => {
    const findings = await run({ ...CLEAN_PERCY_ENV, NODE_TLS_REJECT_UNAUTHORIZED: '1' });
    expect(findings.find(f => f.category === 'env_tls_disabled')).toBeUndefined();
  });

  it('does not warn when NODE_TLS_REJECT_UNAUTHORIZED is unset', async () => {
    const findings = await run({ ...CLEAN_PERCY_ENV, NODE_TLS_REJECT_UNAUTHORIZED: undefined });
    expect(findings.find(f => f.category === 'env_tls_disabled')).toBeUndefined();
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
  it('adds ci_not_detected when not in CI and no CI check results follow', async () => {
    const findings = await run(CLEAN_PERCY_ENV, noCI);
    expect(findings.find(f => f.category === 'ci_not_detected')).toBeDefined();
    // CI-specific findings must not appear
    expect(findings.find(f => f.category === 'ci_detected')).toBeUndefined();
    expect(findings.find(f => f.category === 'ci_commit_missing')).toBeUndefined();
  });

  it('adds ci_detected when CI is detected', async () => {
    const findings = await run(CLEAN_PERCY_ENV, ciEnv());
    const f = findings.find(f => f.category === 'ci_detected');
    expect(f).toBeDefined();
    expect(f.status).toBe('pass');
    expect(f.message).toContain('github');
  });

  it('adds ci_commit_found when commit is present', async () => {
    const findings = await run(CLEAN_PERCY_ENV, ciEnv({ commit: 'deadbeef1234' }));
    const f = findings.find(f => f.category === 'ci_commit_found');
    expect(f).toBeDefined();
    expect(f.message).toContain('deadbeef1234');
  });

  it('adds ci_commit_missing when commit is null', async () => {
    const findings = await run(CLEAN_PERCY_ENV, ciEnv({ commit: null }));
    expect(findings.find(f => f.category === 'ci_commit_missing')).toBeDefined();
    expect(findings.find(f => f.category === 'ci_commit_found')).toBeUndefined();
  });

  it('adds ci_branch_missing when branch is null', async () => {
    const findings = await run(CLEAN_PERCY_ENV, ciEnv({ branch: null }));
    expect(findings.find(f => f.category === 'ci_branch_missing')).toBeDefined();
  });

  it('combines env-audit findings with CI findings in one call', async () => {
    const findings = await run(
      { ...CLEAN_PERCY_ENV, PERCY_TOKEN: 'web_xxx', NODE_TLS_REJECT_UNAUTHORIZED: '0' },
      ciEnv()
    );
    // Env audit findings
    expect(findings.find(f => f.category === 'env_vars_listed')).toBeDefined(); // vars listed
    expect(findings.find(f => f.category === 'env_tls_disabled')).toBeDefined(); // TLS warn
    // CI findings
    expect(findings.find(f => f.category === 'ci_detected')).toBeDefined(); // CI detected
    expect(findings.find(f => f.category === 'ci_commit_found')).toBeDefined(); // commit present
  });

  // ── Parallel config (DR-205 / DR-206) ──────────────────────────────────────

  it('adds ci_parallel_nonce_missing warn when PERCY_PARALLEL_TOTAL is set without PERCY_PARALLEL_NONCE in CI', async () => {
    const findings = await run(
      { ...CLEAN_PERCY_ENV, PERCY_PARALLEL_TOTAL: '4', PERCY_PARALLEL_NONCE: undefined },
      ciEnv()
    );
    const warn = findings.find(f => f.category === 'ci_parallel_nonce_missing');
    expect(warn).toBeDefined();
    expect(warn.status).toBe('warn');
    expect(warn.message).toContain('PERCY_PARALLEL_NONCE');
    expect(findings.find(f => f.category === 'ci_parallel_config_valid')).toBeUndefined();
  });

  it('adds ci_parallel_config_valid pass when both PERCY_PARALLEL_TOTAL and PERCY_PARALLEL_NONCE are set in CI', async () => {
    const findings = await run(
      { ...CLEAN_PERCY_ENV, PERCY_PARALLEL_TOTAL: '4', PERCY_PARALLEL_NONCE: 'build-42' },
      ciEnv()
    );
    const pass = findings.find(f => f.category === 'ci_parallel_config_valid');
    expect(pass).toBeDefined();
    expect(pass.status).toBe('pass');
    expect(pass.message).toContain('PERCY_PARALLEL_TOTAL');
    expect(pass.message).toContain('PERCY_PARALLEL_NONCE');
    expect(findings.find(f => f.category === 'ci_parallel_nonce_missing')).toBeUndefined();
  });

  // ── Git availability (DR-207 / DR-208 / DR-209) ────────────────────────────

  it('adds ci_git_check_skipped info when git is unavailable and PERCY_SKIP_GIT_CHECK=true', async () => {
    spyOn(cp, 'execSync').and.throwError('git: command not found');
    const findings = await run(
      { ...CLEAN_PERCY_ENV, PERCY_SKIP_GIT_CHECK: 'true' },
      ciEnv()
    );
    const info = findings.find(f => f.category === 'ci_git_check_skipped');
    expect(info).toBeDefined();
    expect(info.status).toBe('info');
    expect(info.message).toContain('PERCY_SKIP_GIT_CHECK=true');
    expect(findings.find(f => f.category === 'ci_git_available')).toBeUndefined();
    expect(findings.find(f => f.category === 'ci_git_unavailable')).toBeUndefined();
  });

  it('adds ci_git_unavailable warn when git is unavailable and PERCY_SKIP_GIT_CHECK is not set', async () => {
    spyOn(cp, 'execSync').and.throwError('git: command not found');
    const findings = await run(
      { ...CLEAN_PERCY_ENV, PERCY_SKIP_GIT_CHECK: undefined },
      ciEnv()
    );
    const warn = findings.find(f => f.category === 'ci_git_unavailable');
    expect(warn).toBeDefined();
    expect(warn.status).toBe('warn');
    expect(warn.message).toContain('Git is not available');
    expect(findings.find(f => f.category === 'ci_git_available')).toBeUndefined();
    expect(findings.find(f => f.category === 'ci_git_check_skipped')).toBeUndefined();
  });
});
