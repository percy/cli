import PercyEnv from '@percy/env';

describe('Woodpecker', () => {
  let env;

  beforeEach(() => {
    env = new PercyEnv({
      PERCY_PARALLEL_TOTAL: '-1',
      CI_SYSTEM_NAME: 'woodpecker',
      CI: 'woodpecker',
      CI_COMMIT_SHA: 'woodpecker-commit-sha',
      CI_COMMIT_BRANCH: 'woodpecker-branch',
      CI_PIPELINE_NUMBER: 'woodpecker-pipeline-number'
    });
  });

  it('has the correct properties', () => {
    expect(env).toHaveProperty('ci', 'woodpecker');
    expect(env).toHaveProperty('commit', 'woodpecker-commit-sha');
    expect(env).toHaveProperty('branch', 'woodpecker-branch');
    expect(env).toHaveProperty('target.commit', null);
    expect(env).toHaveProperty('target.branch', null);
    expect(env).toHaveProperty('pullRequest', null);
    expect(env).toHaveProperty('parallel.nonce', 'woodpecker-pipeline-number');
    expect(env).toHaveProperty('parallel.total', -1);
  });

  it('has the correct properties for PR builds', () => {
    env = new PercyEnv({
      ...env.vars,
      CI_PIPELINE_EVENT: 'pull_request',
      CI_COMMIT_PULL_REQUEST: '42'
    });
    expect(env).toHaveProperty('pullRequest', '42');
  });

  it('ignores CI_COMMIT_PULL_REQUEST on non-pull_request events', () => {
    env = new PercyEnv({
      ...env.vars,
      CI_PIPELINE_EVENT: 'push',
      CI_COMMIT_PULL_REQUEST: '42'
    });
    expect(env).toHaveProperty('pullRequest', null);
  });

  it('wins over Drone when Drone-compat vars are also set', () => {
    env = new PercyEnv({
      ...env.vars,
      DRONE: 'true',
      DRONE_COMMIT: 'drone-commit'
    });
    expect(env).toHaveProperty('ci', 'woodpecker');
    expect(env).toHaveProperty('commit', 'woodpecker-commit-sha');
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
