import PercyEnvironment from '../src';

describe('GitHub', () => {
  let env;

  beforeEach(() => {
    env = new PercyEnvironment({
      PERCY_GITHUB_ACTION: 'test-action/0.1.0',
      GITHUB_ACTIONS: 'true',
      GITHUB_SHA: 'github-sha',
      GITHUB_REF: 'refs/head/github-branch'
    });
  });

  it('has the correct properties', () => {
    expect(env).toHaveProperty('ci', 'github');
    expect(env).toHaveProperty('info', 'github/test-action/0.1.0');
    expect(env).toHaveProperty('commit', 'github-sha');
    expect(env).toHaveProperty('branch', 'github-branch');
    expect(env).toHaveProperty('target.commit', null);
    expect(env).toHaveProperty('target.branch', null);
    expect(env).toHaveProperty('pullRequest', null);
    expect(env).toHaveProperty('parallel.nonce', null);
    expect(env).toHaveProperty('parallel.total', null);
  });

  it('has a fallback for unidentified actions', () => {
    env.vars.PERCY_GITHUB_ACTION = null;
    expect(env).toHaveProperty('info', 'github/unknown');
  });

  it('has a fallback when the branch ref cannot be parsed', () => {
    env.vars.GITHUB_REF = 'normal-github-branch';
    expect(env).toHaveProperty('branch', 'normal-github-branch');
  });
});
