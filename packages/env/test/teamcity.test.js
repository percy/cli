import PercyEnv from '@percy/env';

describe('TeamCity', () => {
  let env;

  beforeEach(() => {
    env = new PercyEnv({
      PERCY_PARALLEL_TOTAL: '-1',
      TEAMCITY_VERSION: '2024.07',
      BUILD_VCS_NUMBER: 'teamcity-commit-sha',
      BUILD_NUMBER: 'teamcity-build-number'
    });
  });

  it('has the correct properties', () => {
    expect(env).toHaveProperty('ci', 'teamcity');
    expect(env).toHaveProperty('commit', 'teamcity-commit-sha');
    // TeamCity does not expose branch/PR via standard env vars
    expect(env).toHaveProperty('branch', null);
    expect(env).toHaveProperty('pullRequest', null);
    expect(env).toHaveProperty('parallel.nonce', 'teamcity-build-number');
    expect(env).toHaveProperty('parallel.total', -1);
  });

  it('returns null commit when only the multi-root suffixed var is set', () => {
    env = new PercyEnv({
      PERCY_PARALLEL_TOTAL: '-1',
      TEAMCITY_VERSION: '2024.07',
      BUILD_VCS_NUMBER_Repo1: 'teamcity-multi-root-sha',
      BUILD_NUMBER: 'teamcity-build-number'
    });
    expect(env).toHaveProperty('ci', 'teamcity');
    expect(env).toHaveProperty('commit', null);
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
