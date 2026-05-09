import PercyEnv from '@percy/env';

describe('Codemagic', () => {
  let env;

  beforeEach(() => {
    env = new PercyEnv({
      PERCY_PARALLEL_TOTAL: '-1',
      CM_BUILD_ID: 'codemagic-build-uuid',
      CM_COMMIT: 'codemagic-commit-sha',
      CM_BRANCH: 'codemagic-branch',
      CM_PULL_REQUEST: 'false'
    });
  });

  it('has the correct properties', () => {
    expect(env).toHaveProperty('ci', 'codemagic');
    expect(env).toHaveProperty('commit', 'codemagic-commit-sha');
    expect(env).toHaveProperty('branch', 'codemagic-branch');
    // CM_PULL_REQUEST === 'false' (string) means non-PR build
    expect(env).toHaveProperty('pullRequest', null);
    expect(env).toHaveProperty('parallel.nonce', 'codemagic-build-uuid');
    expect(env).toHaveProperty('parallel.total', -1);
  });

  it('has the correct properties for PR builds', () => {
    env = new PercyEnv({
      ...env.vars,
      CM_PULL_REQUEST: 'true',
      CM_PULL_REQUEST_NUMBER: '42'
    });
    expect(env).toHaveProperty('pullRequest', '42');
  });

  it('ignores CM_PULL_REQUEST_NUMBER when CM_PULL_REQUEST is the string "false"', () => {
    env = new PercyEnv({
      ...env.vars,
      CM_PULL_REQUEST: 'false',
      CM_PULL_REQUEST_NUMBER: '42'
    });
    expect(env).toHaveProperty('pullRequest', null);
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
