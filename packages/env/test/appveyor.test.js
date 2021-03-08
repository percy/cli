import PercyEnvironment from '../src';

describe('Appveyor', () => {
  let env;

  beforeEach(() => {
    env = new PercyEnvironment({
      PERCY_PARALLEL_TOTAL: '-1',
      APPVEYOR_BUILD_ID: 'appveyor-build-id',
      APPVEYOR_REPO_COMMIT: 'appveyor-commit-sha',
      APPVEYOR_REPO_BRANCH: 'appveyor-branch',
      APPVEYOR: 'True'
    });
  });

  it('has the correct properties', () => {
    expect(env).toHaveProperty('ci', 'appveyor');
    expect(env).toHaveProperty('commit', 'appveyor-commit-sha');
    expect(env).toHaveProperty('branch', 'appveyor-branch');
    expect(env).toHaveProperty('target.commit', null);
    expect(env).toHaveProperty('target.branch', null);
    expect(env).toHaveProperty('pullRequest', null);
    expect(env).toHaveProperty('parallel.nonce', 'appveyor-build-id');
    expect(env).toHaveProperty('parallel.total', -1);
  });

  it('has the correct properties for PR builds', () => {
    env = new PercyEnvironment({
      ...env.vars,
      APPVEYOR_PULL_REQUEST_NUMBER: '512',
      APPVEYOR_PULL_REQUEST_HEAD_COMMIT: 'appveyor-pr-commit-sha',
      APPVEYOR_PULL_REQUEST_HEAD_REPO_BRANCH: 'appveyor-pr-branch'
    });

    expect(env).toHaveProperty('pullRequest', '512');
    expect(env).toHaveProperty('branch', 'appveyor-pr-branch');
    expect(env).toHaveProperty('commit', 'appveyor-pr-commit-sha');
  });
});
