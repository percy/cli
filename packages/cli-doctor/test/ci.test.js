/**
 * Tests for packages/cli-doctor/src/checks/ci.js
 *
 * Uses withEnv to control CI environment variables since PercyEnv reads
 * from process.env. Mocks child_process for git availability checks.
 * No external dependencies required.
 */

import { checkCI } from '../src/checks/ci.js';
import { withEnv } from './helpers.js';
import cp from 'child_process';

// Env var combos that simulate different CI environments
const GITHUB_CI_ENV = {
  GITHUB_ACTIONS: 'true',
  GITHUB_SHA: 'abc123def4567890abc123def4567890abc12345',
  GITHUB_REF: 'refs/heads/main',
  // Clear other CI vars to avoid cross-detection
  TRAVIS_BUILD_ID: undefined,
  JENKINS_URL: undefined,
  CIRCLECI: undefined,
  GITLAB_CI: undefined,
  BITBUCKET_BUILD_NUMBER: undefined,
  CI: 'true'
};

const NO_CI_ENV = {
  GITHUB_ACTIONS: undefined,
  TRAVIS_BUILD_ID: undefined,
  JENKINS_URL: undefined,
  CIRCLECI: undefined,
  GITLAB_CI: undefined,
  BITBUCKET_BUILD_NUMBER: undefined,
  CI: undefined,
  CI_NAME: undefined,
  DRONE: undefined,
  SEMAPHORE: undefined,
  BUILDKITE: undefined,
  HEROKU_TEST_RUN_ID: undefined,
  TF_BUILD: undefined,
  APPVEYOR: undefined,
  PROBO_ENVIRONMENT: undefined,
  NETLIFY: undefined,
  HARNESS_PROJECT_ID: undefined,
  PERCY_COMMIT: undefined,
  PERCY_BRANCH: undefined
};

describe('checkCI', () => {
  // ── Not in CI ───────────────────────────────────────────────────────────────

  it('returns PERCY-DR-200 info when not in CI', async () => {
    const findings = await withEnv(NO_CI_ENV, () => checkCI());
    expect(findings.length).toBe(1);
    expect(findings[0].code).toBe('PERCY-DR-200');
    expect(findings[0].status).toBe('info');
    expect(findings[0].message).toContain('Not running in a CI environment');
  });

  it('returns early with only one finding when not in CI', async () => {
    const findings = await withEnv(NO_CI_ENV, () => checkCI());
    expect(findings.length).toBe(1);
    // Should not include commit, branch, parallel, or git checks
  });

  // ── CI detected ─────────────────────────────────────────────────────────────

  it('returns PERCY-DR-201 pass when GitHub Actions is detected', async () => {
    const findings = await withEnv(
      { ...NO_CI_ENV, ...GITHUB_CI_ENV },
      () => checkCI()
    );
    const ciDetected = findings.find(f => f.code === 'PERCY-DR-201');
    expect(ciDetected).toBeDefined();
    expect(ciDetected.status).toBe('pass');
    expect(ciDetected.message).toContain('github');
  });

  it('detects Travis CI', async () => {
    const findings = await withEnv(
      { ...NO_CI_ENV, TRAVIS_BUILD_ID: '12345', CI: 'true' },
      () => checkCI()
    );
    const ciDetected = findings.find(f => f.code === 'PERCY-DR-201');
    expect(ciDetected).toBeDefined();
    expect(ciDetected.message).toContain('travis');
  });

  it('detects GitLab CI', async () => {
    const findings = await withEnv(
      { ...NO_CI_ENV, GITLAB_CI: 'true', CI: 'true' },
      () => checkCI()
    );
    const ciDetected = findings.find(f => f.code === 'PERCY-DR-201');
    expect(ciDetected).toBeDefined();
    expect(ciDetected.message).toContain('gitlab');
  });

  // ── Commit SHA ──────────────────────────────────────────────────────────────

  it('returns PERCY-DR-202 warn when commit SHA is missing in CI', async () => {
    const findings = await withEnv(
      {
        ...NO_CI_ENV,
        ...GITHUB_CI_ENV,
        GITHUB_SHA: undefined,
        PERCY_COMMIT: undefined
      },
      () => checkCI()
    );
    const commitWarn = findings.find(f => f.code === 'PERCY-DR-202');
    expect(commitWarn).toBeDefined();
    expect(commitWarn.status).toBe('warn');
    expect(commitWarn.message).toContain('commit SHA');
    expect(commitWarn.suggestions.some(s => s.includes('PERCY_COMMIT'))).toBe(true);
  });

  it('returns PERCY-DR-203 pass when commit SHA is present', async () => {
    const findings = await withEnv(
      { ...NO_CI_ENV, ...GITHUB_CI_ENV },
      () => checkCI()
    );
    const commitPass = findings.find(f => f.code === 'PERCY-DR-203');
    expect(commitPass).toBeDefined();
    expect(commitPass.status).toBe('pass');
    expect(commitPass.message).toContain('abc123def456'); // First 12 chars
  });

  it('truncates long commit SHA in message', async () => {
    const findings = await withEnv(
      { ...NO_CI_ENV, ...GITHUB_CI_ENV },
      () => checkCI()
    );
    const commitPass = findings.find(f => f.code === 'PERCY-DR-203');
    // Should show truncated SHA with ellipsis
    expect(commitPass.message).toContain('...');
  });

  it('uses PERCY_COMMIT override', async () => {
    const findings = await withEnv(
      {
        ...NO_CI_ENV,
        ...GITHUB_CI_ENV,
        PERCY_COMMIT: 'custom_sha_12345'
      },
      () => checkCI()
    );
    const commitPass = findings.find(f => f.code === 'PERCY-DR-203');
    expect(commitPass).toBeDefined();
    expect(commitPass.message).toContain('custom_sha_1');
  });

  // ── Branch ──────────────────────────────────────────────────────────────────

  it('returns PERCY-DR-204 warn when branch is missing in CI', async () => {
    const findings = await withEnv(
      {
        ...NO_CI_ENV,
        ...GITHUB_CI_ENV,
        GITHUB_REF: undefined,
        PERCY_BRANCH: undefined
      },
      () => checkCI()
    );
    const branchWarn = findings.find(f => f.code === 'PERCY-DR-204');
    expect(branchWarn).toBeDefined();
    expect(branchWarn.status).toBe('warn');
    expect(branchWarn.message).toContain('branch name');
    expect(branchWarn.suggestions.some(s => s.includes('PERCY_BRANCH'))).toBe(true);
  });

  it('does not warn about branch when branch is present', async () => {
    const findings = await withEnv(
      { ...NO_CI_ENV, ...GITHUB_CI_ENV },
      () => checkCI()
    );
    const branchWarn = findings.find(f => f.code === 'PERCY-DR-204');
    expect(branchWarn).toBeUndefined();
  });

  // ── Parallel config ─────────────────────────────────────────────────────────

  it('returns PERCY-DR-205 warn when PERCY_PARALLEL_TOTAL is set but NONCE is missing', async () => {
    const findings = await withEnv(
      {
        ...NO_CI_ENV,
        ...GITHUB_CI_ENV,
        PERCY_PARALLEL_TOTAL: '4',
        PERCY_PARALLEL_NONCE: undefined
      },
      () => checkCI()
    );
    const parallelWarn = findings.find(f => f.code === 'PERCY-DR-205');
    expect(parallelWarn).toBeDefined();
    expect(parallelWarn.status).toBe('warn');
    expect(parallelWarn.message).toContain('PERCY_PARALLEL_NONCE');
  });

  it('returns PERCY-DR-206 pass when both parallel vars are set', async () => {
    const findings = await withEnv(
      {
        ...NO_CI_ENV,
        ...GITHUB_CI_ENV,
        PERCY_PARALLEL_TOTAL: '4',
        PERCY_PARALLEL_NONCE: 'build-42'
      },
      () => checkCI()
    );
    const parallelPass = findings.find(f => f.code === 'PERCY-DR-206');
    expect(parallelPass).toBeDefined();
    expect(parallelPass.status).toBe('pass');
    expect(parallelPass.message).toContain('total=4');
    expect(parallelPass.message).toContain('nonce=build-42');
  });

  it('skips parallel checks when PERCY_PARALLEL_TOTAL is not set', async () => {
    const findings = await withEnv(
      {
        ...NO_CI_ENV,
        ...GITHUB_CI_ENV,
        PERCY_PARALLEL_TOTAL: undefined,
        PERCY_PARALLEL_NONCE: undefined
      },
      () => checkCI()
    );
    const parallelFindings = findings.filter(f =>
      f.code === 'PERCY-DR-205' || f.code === 'PERCY-DR-206'
    );
    expect(parallelFindings.length).toBe(0);
  });

  // ── Git availability ────────────────────────────────────────────────────────

  it('returns PERCY-DR-207 pass when git is available', async () => {
    // Git IS available since we're running in a git repo
    const findings = await withEnv(
      {
        ...NO_CI_ENV,
        ...GITHUB_CI_ENV,
        PERCY_PARALLEL_TOTAL: undefined,
        PERCY_PARALLEL_NONCE: undefined,
        PERCY_SKIP_GIT_CHECK: undefined
      },
      () => checkCI()
    );
    const gitPass = findings.find(f => f.code === 'PERCY-DR-207');
    expect(gitPass).toBeDefined();
    expect(gitPass.status).toBe('pass');
    expect(gitPass.message).toContain('Git repository detected');
  });

  it('returns PERCY-DR-208 info when PERCY_SKIP_GIT_CHECK=true', async () => {
    // Mock execSync to simulate git not available
    spyOn(cp, 'execSync').and.throwError('git not found');
    const findings = await withEnv(
      {
        ...NO_CI_ENV,
        ...GITHUB_CI_ENV,
        PERCY_SKIP_GIT_CHECK: 'true',
        PERCY_PARALLEL_TOTAL: undefined,
        PERCY_PARALLEL_NONCE: undefined
      },
      () => checkCI()
    );
    const gitSkip = findings.find(f => f.code === 'PERCY-DR-208');
    expect(gitSkip).toBeDefined();
    expect(gitSkip.status).toBe('info');
    expect(gitSkip.message).toContain('PERCY_SKIP_GIT_CHECK');
  });

  // ── Full CI pass scenario ──────────────────────────────────────────────────

  it('returns all pass findings for fully configured CI', async () => {
    const findings = await withEnv(
      {
        ...NO_CI_ENV,
        ...GITHUB_CI_ENV,
        PERCY_PARALLEL_TOTAL: undefined,
        PERCY_PARALLEL_NONCE: undefined,
        PERCY_SKIP_GIT_CHECK: undefined
      },
      () => checkCI()
    );
    // Should have: CI detected (201), commit pass (203), git pass (207)
    expect(findings.find(f => f.code === 'PERCY-DR-201')).toBeDefined();
    expect(findings.find(f => f.code === 'PERCY-DR-203')).toBeDefined();
    expect(findings.find(f => f.code === 'PERCY-DR-207')).toBeDefined();
    // No warnings or failures
    const warnings = findings.filter(f => f.status === 'warn' || f.status === 'fail');
    expect(warnings.length).toBe(0);
  });
});
