import PercyEnv from '@percy/env';

describe('AWS CodeBuild', () => {
  let env;

  beforeEach(() => {
    env = new PercyEnv({
      PERCY_PARALLEL_TOTAL: '-1',
      CODEBUILD_BUILD_ID: 'codebuild:build-id',
      CODEBUILD_RESOLVED_SOURCE_VERSION: 'codebuild-commit-sha',
      CODEBUILD_WEBHOOK_HEAD_REF: 'refs/heads/codebuild-branch',
      CODEBUILD_WEBHOOK_TRIGGER: 'branch/codebuild-branch'
    });
  });

  it('has the correct properties', () => {
    expect(env).toHaveProperty('ci', 'aws-codebuild');
    expect(env).toHaveProperty('commit', 'codebuild-commit-sha');
    expect(env).toHaveProperty('branch', 'codebuild-branch');
    expect(env).toHaveProperty('pullRequest', null);
    expect(env).toHaveProperty('parallel.nonce', 'codebuild:build-id');
    expect(env).toHaveProperty('parallel.total', -1);
  });

  it('parses pull-request number from CODEBUILD_WEBHOOK_TRIGGER', () => {
    env = new PercyEnv({
      ...env.vars,
      CODEBUILD_WEBHOOK_TRIGGER: 'pr/42'
    });
    expect(env).toHaveProperty('pullRequest', '42');
  });

  it('does not misattribute tag triggers as pull requests', () => {
    env = new PercyEnv({
      ...env.vars,
      CODEBUILD_WEBHOOK_TRIGGER: 'tag/v1.0.0'
    });
    expect(env).toHaveProperty('pullRequest', null);
  });

  it('returns null for branch and PR on manual or EventBridge triggers (no webhook vars)', () => {
    env = new PercyEnv({
      PERCY_PARALLEL_TOTAL: '-1',
      CODEBUILD_BUILD_ID: 'codebuild:build-id',
      CODEBUILD_RESOLVED_SOURCE_VERSION: 'codebuild-commit-sha'
    });
    expect(env).toHaveProperty('ci', 'aws-codebuild');
    expect(env).toHaveProperty('commit', 'codebuild-commit-sha');
    expect(env).toHaveProperty('branch', null);
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
