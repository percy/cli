import PercyEnv from '../src';

describe('CircleCI', () => {
  let env;

  beforeEach(() => {
    env = new PercyEnv({
      PERCY_PARALLEL_TOTAL: '-1',
      CIRCLE_BRANCH: 'circle-branch',
      CIRCLE_SHA1: 'circle-commit-sha',
      CI_PULL_REQUESTS: 'https://github.com/owner/repo-name/pull/123',
      CIRCLE_BUILD_NUM: 'build-number',
      CIRCLECI: 'true'
    });
  });

  it('has the correct properties', () => {
    expect(env).toHaveProperty('ci', 'circle');
    expect(env).toHaveProperty('commit', 'circle-commit-sha');
    expect(env).toHaveProperty('branch', 'circle-branch');
    expect(env).toHaveProperty('target.commit', null);
    expect(env).toHaveProperty('target.branch', null);
    expect(env).toHaveProperty('pullRequest', '123');
    expect(env).toHaveProperty('parallel.nonce', 'build-number');
    expect(env).toHaveProperty('parallel.total', -1);
  });

  it('has the correct parallel nonce in 2.x', () => {
    env = new PercyEnv({ ...env.vars, CIRCLE_WORKFLOW_ID: 'workflow-id' });
    expect(env).toHaveProperty('parallel.nonce', 'workflow-id');
  });
});
