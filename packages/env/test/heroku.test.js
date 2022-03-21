import PercyEnv from '@percy/env';

describe('Heroku', () => {
  let env;

  beforeEach(() => {
    env = new PercyEnv({
      PERCY_PARALLEL_TOTAL: '-1',
      HEROKU_TEST_RUN_COMMIT_VERSION: 'heroku-commit-sha',
      HEROKU_TEST_RUN_BRANCH: 'heroku-branch',
      HEROKU_TEST_RUN_ID: 'heroku-test-run-id',
      HEROKU_PR_NUMBER: '123'
    });
  });

  it('has the correct properties', () => {
    expect(env).toHaveProperty('ci', 'heroku');
    expect(env).toHaveProperty('commit', 'heroku-commit-sha');
    expect(env).toHaveProperty('branch', 'heroku-branch');
    expect(env).toHaveProperty('target.commit', null);
    expect(env).toHaveProperty('target.branch', null);
    expect(env).toHaveProperty('pullRequest', '123');
    expect(env).toHaveProperty('parallel.nonce', 'heroku-test-run-id');
    expect(env).toHaveProperty('parallel.total', -1);
  });
});
