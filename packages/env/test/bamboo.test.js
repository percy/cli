import PercyEnv from '@percy/env';

describe('Bamboo', () => {
  let env;

  beforeEach(() => {
    env = new PercyEnv({
      PERCY_PARALLEL_TOTAL: '-1',
      bamboo_buildKey: 'PROJ-PLAN-JOB',
      bamboo_planRepository_revision: 'bamboo-commit-sha',
      bamboo_planRepository_branchName: 'bamboo-branch',
      bamboo_buildResultKey: 'PROJ-PLAN-JOB-42',
      bamboo_buildNumber: '42'
    });
  });

  it('has the correct properties', () => {
    expect(env).toHaveProperty('ci', 'bamboo');
    expect(env).toHaveProperty('commit', 'bamboo-commit-sha');
    expect(env).toHaveProperty('branch', 'bamboo-branch');
    expect(env).toHaveProperty('pullRequest', null);
    // buildResultKey (not buildNumber) so reruns don't collide
    expect(env).toHaveProperty('parallel.nonce', 'PROJ-PLAN-JOB-42');
    expect(env).toHaveProperty('parallel.total', -1);
  });

  it('has the correct properties for PR builds', () => {
    env = new PercyEnv({
      ...env.vars,
      bamboo_repository_pr_key: '7'
    });
    expect(env).toHaveProperty('pullRequest', '7');
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
