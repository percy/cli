import PercyEnv from '@percy/env';

describe('Buildkite', () => {
  let env;

  beforeEach(() => {
    env = new PercyEnv({
      PERCY_PARALLEL_TOTAL: '-1',
      BUILDKITE_COMMIT: 'buildkite-commit-sha',
      BUILDKITE_BRANCH: 'buildkite-branch',
      BUILDKITE_PULL_REQUEST: 'false',
      BUILDKITE_BUILD_ID: 'buildkite-build-id',
      BUILDKITE: 'true'
    });
  });

  it('has the correct properties', () => {
    expect(env).toHaveProperty('ci', 'buildkite');
    expect(env).toHaveProperty('commit', 'buildkite-commit-sha');
    expect(env).toHaveProperty('branch', 'buildkite-branch');
    expect(env).toHaveProperty('target.commit', null);
    expect(env).toHaveProperty('target.branch', null);
    expect(env).toHaveProperty('pullRequest', null);
    expect(env).toHaveProperty('parallel.nonce', 'buildkite-build-id');
    expect(env).toHaveProperty('parallel.total', -1);
  });

  it('has the correct properties for PR builds', () => {
    env = new PercyEnv({ ...env.vars, BUILDKITE_PULL_REQUEST: '123' });
    expect(env).toHaveProperty('pullRequest', '123');
  });

  it('returns null sha when commit is HEAD', () => {
    env = new PercyEnv({ ...env.vars, BUILDKITE_COMMIT: 'HEAD' });
    expect(env).toHaveProperty('commit', null);
  });
});
