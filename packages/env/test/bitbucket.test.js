import PercyEnv from '../src';

describe('Bitbucket', () => {
  let env;

  beforeEach(() => {
    env = new PercyEnv({
      PERCY_PARALLEL_TOTAL: '-1',
      BITBUCKET_BUILD_NUMBER: 'bitbucket-build-number',
      BITBUCKET_COMMIT: 'bitbucket-commit-sha',
      BITBUCKET_BRANCH: 'bitbucket-branch',
      BITBUCKET_PR_ID: '981'
    });
  });

  it('has the correct properties', () => {
    expect(env).toHaveProperty('ci', 'bitbucket');
    expect(env).toHaveProperty('commit', 'bitbucket-commit-sha');
    expect(env).toHaveProperty('branch', 'bitbucket-branch');
    expect(env).toHaveProperty('target.commit', null);
    expect(env).toHaveProperty('target.branch', null);
    expect(env).toHaveProperty('pullRequest', '981');
    expect(env).toHaveProperty('parallel.nonce', 'bitbucket-build-number');
    expect(env).toHaveProperty('parallel.total', -1);
  });
});
