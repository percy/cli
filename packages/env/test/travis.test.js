import expect from 'expect';
import PercyEnvironment from '../src';

describe('Travis', () => {
  let env;

  beforeEach(() => {
    env = new PercyEnvironment({
      TRAVIS_BUILD_ID: '1234',
      TRAVIS_PULL_REQUEST: 'false',
      TRAVIS_PULL_REQUEST_BRANCH: '',
      TRAVIS_COMMIT: 'travis-commit-sha',
      TRAVIS_BRANCH: 'travis-branch',
      TRAVIS_BUILD_NUMBER: 'build-number',
      CI_NODE_TOTAL: '3'
    });
  });

  it('has the correct properties', () => {
    expect(env).toHaveProperty('ci', 'travis');
    expect(env).toHaveProperty('commit', 'travis-commit-sha');
    expect(env).toHaveProperty('branch', 'travis-branch');
    expect(env).toHaveProperty('target.commit', null);
    expect(env).toHaveProperty('target.branch', null);
    expect(env).toHaveProperty('pullRequest', null);
    expect(env).toHaveProperty('parallel.nonce', 'build-number');
    expect(env).toHaveProperty('parallel.total', 3);
  });

  it('has the correct properties for PR builds', () => {
    env = new PercyEnvironment({
      ...env.vars,
      TRAVIS_PULL_REQUEST: '256',
      TRAVIS_PULL_REQUEST_BRANCH: 'travis-pr-branch'
    });

    expect(env).toHaveProperty('pullRequest', '256');
    expect(env).toHaveProperty('branch', 'travis-pr-branch');
    expect(env).toHaveProperty('commit', 'travis-commit-sha');
  });
});
