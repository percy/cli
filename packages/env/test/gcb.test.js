import PercyEnv from '@percy/env';

describe('Google Cloud Build', () => {
  let env;

  beforeEach(() => {
    env = new PercyEnv({
      PERCY_PARALLEL_TOTAL: '-1',
      BUILD_ID: 'gcb-build-id',
      PROJECT_ID: 'my-gcp-project',
      COMMIT_SHA: 'gcb-commit-sha',
      BRANCH_NAME: 'gcb-branch'
    });
  });

  it('has the correct properties', () => {
    expect(env).toHaveProperty('ci', 'gcb');
    expect(env).toHaveProperty('commit', 'gcb-commit-sha');
    expect(env).toHaveProperty('branch', 'gcb-branch');
    expect(env).toHaveProperty('pullRequest', null);
    expect(env).toHaveProperty('parallel.nonce', 'gcb-build-id');
    expect(env).toHaveProperty('parallel.total', -1);
  });

  it('has the correct properties for PR triggers', () => {
    env = new PercyEnv({ ...env.vars, _PR_NUMBER: '42' });
    expect(env).toHaveProperty('pullRequest', '42');
  });

  it('returns null commit/branch/PR on manual gcloud submits (no trigger vars)', () => {
    env = new PercyEnv({
      PERCY_PARALLEL_TOTAL: '-1',
      BUILD_ID: 'gcb-build-id',
      PROJECT_ID: 'my-gcp-project'
    });
    expect(env).toHaveProperty('ci', 'gcb');
    expect(env).toHaveProperty('commit', null);
    expect(env).toHaveProperty('branch', null);
    expect(env).toHaveProperty('pullRequest', null);
  });

  it('does not match when JENKINS_URL is also set (Jenkins wins)', () => {
    env = new PercyEnv({
      PERCY_PARALLEL_TOTAL: '-1',
      JENKINS_URL: 'https://jenkins.example.com',
      BUILD_ID: 'jenkins-build-id',
      PROJECT_ID: 'my-gcp-project'
    });
    expect(env).toHaveProperty('ci', 'jenkins');
  });

  it('respects PERCY_* overrides', () => {
    env = new PercyEnv({
      ...env.vars,
      PERCY_COMMIT: 'override-commit',
      PERCY_BRANCH: 'override-branch',
      PERCY_PULL_REQUEST: '999'
    });
    expect(env).toHaveProperty('commit', 'override-commit');
    expect(env).toHaveProperty('branch', 'override-branch');
    expect(env).toHaveProperty('pullRequest', '999');
  });
});
