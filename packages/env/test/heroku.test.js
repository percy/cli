import expect from 'expect';
import PercyEnvironment from '../src';

describe('Heroku', () => {
  let env;

  beforeEach(() => {
    env = new PercyEnvironment({
      HEROKU_TEST_RUN_COMMIT_VERSION: 'heroku-commit-sha',
      HEROKU_TEST_RUN_BRANCH: 'heroku-branch',
      HEROKU_TEST_RUN_ID: 'heroku-test-run-id',
      // todo - why was this commented out?
      // HEROKU_PULL_REQUEST: '123',
      CI_NODE_TOTAL: '3'
    });
  });

  it('has the correct properties', () => {
    expect(env).toHaveProperty('ci', 'heroku');
    expect(env).toHaveProperty('commit', 'heroku-commit-sha');
    expect(env).toHaveProperty('branch', 'heroku-branch');
    expect(env).toHaveProperty('target.commit', null);
    expect(env).toHaveProperty('target.branch', null);
    expect(env).toHaveProperty('pullRequest', null);
    expect(env).toHaveProperty('parallel.nonce', 'heroku-test-run-id');
    expect(env).toHaveProperty('parallel.total', 3);
  });
});
