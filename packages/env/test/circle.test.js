import expect from 'expect';
import PercyEnvironment from '../src';

describe('CircleCI', () => {
  let env;

  beforeEach(() => {
    env = new PercyEnvironment({
      CIRCLECI: 'true',
      CIRCLE_BRANCH: 'circle-branch',
      CIRCLE_SHA1: 'circle-commit-sha',
      CI_PULL_REQUESTS: 'https://github.com/owner/repo-name/pull/123',
      CIRCLE_BUILD_NUM: 'build-number'
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
    expect(env).toHaveProperty('parallel.total', null);
  });

  it('has the correct parallel nonce in 2.x', () => {
    env = new PercyEnvironment({ ...env.vars, CIRCLE_WORKFLOW_ID: 'workflow-id' });
    expect(env).toHaveProperty('parallel.nonce', 'workflow-id');
  });
});
