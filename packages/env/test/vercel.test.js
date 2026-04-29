import PercyEnv from '@percy/env';

describe('Vercel', () => {
  let env;

  beforeEach(() => {
    env = new PercyEnv({
      PERCY_PARALLEL_TOTAL: '-1',
      VERCEL: '1',
      VERCEL_GIT_COMMIT_SHA: 'vercel-commit-sha',
      VERCEL_GIT_COMMIT_REF: 'vercel-branch',
      VERCEL_GIT_PULL_REQUEST_ID: '',
      VERCEL_DEPLOYMENT_ID: 'dpl_vercel-deployment-id'
    });
  });

  it('has the correct properties', () => {
    expect(env).toHaveProperty('ci', 'vercel');
    expect(env).toHaveProperty('commit', 'vercel-commit-sha');
    expect(env).toHaveProperty('branch', 'vercel-branch');
    // Empty string when branch has no PR yet or on production deploys
    expect(env).toHaveProperty('pullRequest', null);
    expect(env).toHaveProperty('parallel.nonce', 'dpl_vercel-deployment-id');
    expect(env).toHaveProperty('parallel.total', -1);
  });

  it('has the correct properties for PR builds', () => {
    env = new PercyEnv({ ...env.vars, VERCEL_GIT_PULL_REQUEST_ID: '42' });
    expect(env).toHaveProperty('pullRequest', '42');
  });

  it('falls through to CI/unknown when system env vars are not exposed (checkbox off)', () => {
    env = new PercyEnv({ CI: 'true' });
    expect(env).toHaveProperty('ci', 'CI/unknown');
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
