/**
 * Tests for packages/cli-doctor/src/checks/env-audit.js
 *
 * Uses withEnv to control environment variables.
 * No external dependencies required.
 */

import { checkEnvVars } from '../src/checks/env-audit.js';
import { withEnv } from './helpers.js';

// Base env that clears all Percy vars to ensure clean state
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

describe('checkEnvVars', () => {
  // ── No Percy vars ─────────────────────────────────────────────────────────

  it('returns PERCY-DR-300 info when no Percy vars are set', async () => {
    const findings = await withEnv(CLEAN_PERCY_ENV, () => checkEnvVars());
    expect(findings.length).toBeGreaterThanOrEqual(1);
    const info = findings.find(f => f.code === 'PERCY-DR-300');
    expect(info).toBeDefined();
    expect(info.status).toBe('info');
    expect(info.message).toContain('No Percy-specific environment variables detected');
  });

  // ── Percy vars detected ───────────────────────────────────────────────────

  it('returns PERCY-DR-301 listing set vars', async () => {
    const findings = await withEnv(
      { ...CLEAN_PERCY_ENV, PERCY_TOKEN: 'test', PERCY_DEBUG: 'true' },
      () => checkEnvVars()
    );
    const listing = findings.find(f => f.code === 'PERCY-DR-301');
    expect(listing).toBeDefined();
    expect(listing.status).toBe('info');
    expect(listing.message).toContain('PERCY_TOKEN');
    expect(listing.message).toContain('PERCY_DEBUG');
  });

  it('includes PERCY_AUTO_DOCTOR in listed vars', async () => {
    const findings = await withEnv(
      { ...CLEAN_PERCY_ENV, PERCY_AUTO_DOCTOR: 'true' },
      () => checkEnvVars()
    );
    const listing = findings.find(f => f.code === 'PERCY-DR-301');
    expect(listing).toBeDefined();
    expect(listing.message).toContain('PERCY_AUTO_DOCTOR');
  });

  // ── PERCY_PARALLEL_TOTAL validation ───────────────────────────────────────

  it('returns PERCY-DR-303 fail when PERCY_PARALLEL_TOTAL is not a valid integer', async () => {
    const findings = await withEnv(
      { ...CLEAN_PERCY_ENV, PERCY_PARALLEL_TOTAL: 'abc' },
      () => checkEnvVars()
    );
    const fail = findings.find(f => f.code === 'PERCY-DR-303');
    expect(fail).toBeDefined();
    expect(fail.status).toBe('fail');
    expect(fail.message).toContain('PERCY_PARALLEL_TOTAL');
  });

  it('returns PERCY-DR-303 fail when PERCY_PARALLEL_TOTAL is zero', async () => {
    const findings = await withEnv(
      { ...CLEAN_PERCY_ENV, PERCY_PARALLEL_TOTAL: '0' },
      () => checkEnvVars()
    );
    const fail = findings.find(f => f.code === 'PERCY-DR-303');
    expect(fail).toBeDefined();
    expect(fail.status).toBe('fail');
  });

  it('returns PERCY-DR-303 fail when PERCY_PARALLEL_TOTAL is negative', async () => {
    const findings = await withEnv(
      { ...CLEAN_PERCY_ENV, PERCY_PARALLEL_TOTAL: '-3' },
      () => checkEnvVars()
    );
    const fail = findings.find(f => f.code === 'PERCY-DR-303');
    expect(fail).toBeDefined();
    expect(fail.status).toBe('fail');
  });

  it('returns PERCY-DR-303 fail when PERCY_PARALLEL_TOTAL is a float', async () => {
    const findings = await withEnv(
      { ...CLEAN_PERCY_ENV, PERCY_PARALLEL_TOTAL: '4.5' },
      () => checkEnvVars()
    );
    const fail = findings.find(f => f.code === 'PERCY-DR-303');
    expect(fail).toBeDefined();
    expect(fail.status).toBe('fail');
  });

  it('does not fail when PERCY_PARALLEL_TOTAL is a valid positive integer', async () => {
    const findings = await withEnv(
      { ...CLEAN_PERCY_ENV, PERCY_PARALLEL_TOTAL: '4' },
      () => checkEnvVars()
    );
    const fail = findings.find(f => f.code === 'PERCY-DR-303');
    expect(fail).toBeUndefined();
  });

  // ── Manual overrides ──────────────────────────────────────────────────────

  it('returns PERCY-DR-304 info when manual overrides are active', async () => {
    const findings = await withEnv(
      { ...CLEAN_PERCY_ENV, PERCY_COMMIT: 'abc123', PERCY_BRANCH: 'main' },
      () => checkEnvVars()
    );
    const override = findings.find(f => f.code === 'PERCY-DR-304');
    expect(override).toBeDefined();
    expect(override.status).toBe('info');
    expect(override.message).toContain('PERCY_COMMIT');
    expect(override.message).toContain('PERCY_BRANCH');
    expect(override.message).toContain('Manual overrides');
  });

  it('does not warn about overrides when none are set', async () => {
    const findings = await withEnv(
      { ...CLEAN_PERCY_ENV, PERCY_TOKEN: 'test' },
      () => checkEnvVars()
    );
    const override = findings.find(f => f.code === 'PERCY-DR-304');
    expect(override).toBeUndefined();
  });

  // ── NODE_TLS_REJECT_UNAUTHORIZED ──────────────────────────────────────────

  it('returns PERCY-DR-305 warn when NODE_TLS_REJECT_UNAUTHORIZED=0', async () => {
    const findings = await withEnv(
      { ...CLEAN_PERCY_ENV, NODE_TLS_REJECT_UNAUTHORIZED: '0' },
      () => checkEnvVars()
    );
    const warn = findings.find(f => f.code === 'PERCY-DR-305');
    expect(warn).toBeDefined();
    expect(warn.status).toBe('warn');
    expect(warn.message).toContain('NODE_TLS_REJECT_UNAUTHORIZED=0');
    expect(warn.suggestions.some(s => s.includes('NODE_EXTRA_CA_CERTS'))).toBe(true);
  });

  it('does not warn when NODE_TLS_REJECT_UNAUTHORIZED is 1', async () => {
    const findings = await withEnv(
      { ...CLEAN_PERCY_ENV, NODE_TLS_REJECT_UNAUTHORIZED: '1' },
      () => checkEnvVars()
    );
    const warn = findings.find(f => f.code === 'PERCY-DR-305');
    expect(warn).toBeUndefined();
  });

  it('does not warn when NODE_TLS_REJECT_UNAUTHORIZED is unset', async () => {
    const findings = await withEnv(
      { ...CLEAN_PERCY_ENV, NODE_TLS_REJECT_UNAUTHORIZED: undefined },
      () => checkEnvVars()
    );
    const warn = findings.find(f => f.code === 'PERCY-DR-305');
    expect(warn).toBeUndefined();
  });

  // ── SECURITY: no env var values in output ─────────────────────────────────

  it('never includes PERCY_TOKEN value in findings', async () => {
    const secret = 'web_my_super_secret_token_value';
    const findings = await withEnv(
      { ...CLEAN_PERCY_ENV, PERCY_TOKEN: secret },
      () => checkEnvVars()
    );
    const allText = findings.map(f =>
      `${f.message} ${(f.suggestions || []).join(' ')}`
    ).join(' ');

    expect(allText).not.toContain('my_super_secret');
    expect(allText).not.toContain('token_value');
    // Variable NAME is fine, but VALUE must not appear
    expect(allText).toContain('PERCY_TOKEN');
  });
});
