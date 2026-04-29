import PercyEnv from '@percy/env';

describe('GoCD', () => {
  let env;

  beforeEach(() => {
    env = new PercyEnv({
      PERCY_PARALLEL_TOTAL: '-1',
      GO_PIPELINE_NAME: 'my-pipeline',
      GO_SERVER_URL: 'https://gocd.example.com',
      GO_REVISION: 'gocd-commit-sha',
      GO_PIPELINE_COUNTER: '42',
      GO_STAGE_COUNTER: '1'
    });
  });

  it('has the correct properties', () => {
    expect(env).toHaveProperty('ci', 'gocd');
    expect(env).toHaveProperty('commit', 'gocd-commit-sha');
    // GoCD does not expose branch/PR via standard env vars
    expect(env).toHaveProperty('branch', null);
    expect(env).toHaveProperty('pullRequest', null);
    // Composite pipeline.stage counter to survive stage reruns
    expect(env).toHaveProperty('parallel.nonce', '42.1');
    expect(env).toHaveProperty('parallel.total', -1);
  });

  it('nonce changes when the stage counter bumps on rerun', () => {
    env = new PercyEnv({ ...env.vars, GO_STAGE_COUNTER: '2' });
    expect(env).toHaveProperty('parallel.nonce', '42.2');
  });

  it('falls back to pipeline counter alone when stage counter is absent', () => {
    env = new PercyEnv({ ...env.vars, GO_STAGE_COUNTER: undefined });
    expect(env).toHaveProperty('parallel.nonce', '42');
  });

  it('returns null commit on multi-material pipelines (GO_REVISION unset)', () => {
    env = new PercyEnv({
      PERCY_PARALLEL_TOTAL: '-1',
      GO_PIPELINE_NAME: 'my-pipeline',
      GO_SERVER_URL: 'https://gocd.example.com',
      GO_PIPELINE_COUNTER: '42',
      GO_STAGE_COUNTER: '1'
    });
    expect(env).toHaveProperty('ci', 'gocd');
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
