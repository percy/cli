import PercyEnv from '@percy/env';

describe('Harness', () => {
  let env;

  beforeEach(() => {
    env = new PercyEnv({
      PERCY_PARALLEL_TOTAL: '-1',
      DRONE_COMMIT_BRANCH: 'harness-branch',
      DRONE_COMMIT_SHA: 'harness-commit-sha',
      DRONE_BUILD_EVENT: 'pull_request',
      DRONE_COMMIT_LINK: 'https://github.com/owner/repo-name/pull/718',
      HARNESS_BUILD_ID: '49',
      HARNESS_PROJECT_ID: 'harness-project-1'
    });
  });

  it('has the correct properties', () => {
    expect(env).toHaveProperty('ci', 'harness');
    expect(env).toHaveProperty('commit', 'harness-commit-sha');
    expect(env).toHaveProperty('branch', 'harness-branch');
    expect(env).toHaveProperty('target.commit', null);
    expect(env).toHaveProperty('target.branch', null);
    expect(env).toHaveProperty('pullRequest', '718');
    expect(env).toHaveProperty('parallel.nonce', '49');
    expect(env).toHaveProperty('parallel.total', -1);
  });

  it('has the correct parallel nonce in 2.x', () => {
    env = new PercyEnv({ ...env.vars, HARNESS_BUILD_ID: 'harness-build-id' });
    expect(env).toHaveProperty('parallel.nonce', 'harness-build-id');
  });
});
