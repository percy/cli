import expect from 'expect';
import PercyEnvironment from '../src';

describe('CodeShip', () => {
  let env;

  beforeEach(function() {
    env = new PercyEnvironment({
      CI_NAME: 'codeship',
      CI_BRANCH: 'codeship-branch',
      CI_BUILD_NUMBER: 'codeship-build-number',
      CI_BUILD_ID: 'codeship-build-id',
      CI_COMMIT_ID: 'codeship-commit-sha',
      CI_PULL_REQUEST: 'false',
      CI_NODE_TOTAL: '3'
    });
  });

  it('has the correct properties', () => {
    expect(env).toHaveProperty('ci', 'codeship');
    expect(env).toHaveProperty('commit', 'codeship-commit-sha');
    expect(env).toHaveProperty('branch', 'codeship-branch');
    expect(env).toHaveProperty('target.commit', null);
    expect(env).toHaveProperty('target.branch', null);
    expect(env).toHaveProperty('pullRequest', null);
    expect(env).toHaveProperty('parallel.nonce', 'codeship-build-number');
    expect(env).toHaveProperty('parallel.total', 3);
  });

  it('has nonce fallback for CodeShip Pro', () => {
    env = new PercyEnvironment({
      ...env.vars,
      CI_BUILD_NUMBER: ''
    });

    expect(env).toHaveProperty('parallel.nonce', 'codeship-build-id');
  });
});
