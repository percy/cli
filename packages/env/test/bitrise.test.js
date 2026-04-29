import PercyEnv from '@percy/env';

describe('Bitrise', () => {
  let env;

  beforeEach(() => {
    env = new PercyEnv({
      PERCY_PARALLEL_TOTAL: '-1',
      BITRISE_IO: 'true',
      BITRISE_GIT_COMMIT: 'bitrise-commit-sha',
      BITRISE_GIT_BRANCH: 'bitrise-branch',
      BITRISE_PULL_REQUEST: '',
      BITRISE_BUILD_NUMBER: 'bitrise-build-number'
    });
  });

  it('has the correct properties', () => {
    expect(env).toHaveProperty('ci', 'bitrise');
    expect(env).toHaveProperty('commit', 'bitrise-commit-sha');
    expect(env).toHaveProperty('branch', 'bitrise-branch');
    // Bitrise sets empty string on non-PR builds
    expect(env).toHaveProperty('pullRequest', null);
    expect(env).toHaveProperty('parallel.nonce', 'bitrise-build-number');
    expect(env).toHaveProperty('parallel.total', -1);
  });

  it('has the correct properties for PR builds', () => {
    env = new PercyEnv({ ...env.vars, BITRISE_PULL_REQUEST: '42' });
    expect(env).toHaveProperty('pullRequest', '42');
  });

  it('respects PERCY_* overrides', () => {
    env = new PercyEnv({
      ...env.vars,
      PERCY_COMMIT: 'override-commit',
      PERCY_BRANCH: 'override-branch',
      PERCY_PULL_REQUEST: '999'
    });
    expect(env).toHaveProperty('commit', 'override-commit');
    expect(env).toHaveProperty('branch', 'override-branch');
    expect(env).toHaveProperty('pullRequest', '999');
  });
});
