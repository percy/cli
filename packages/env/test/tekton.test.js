import PercyEnv from '@percy/env';

describe('Tekton Pipelines', () => {
  let env;

  beforeEach(() => {
    env = new PercyEnv({
      PERCY_PARALLEL_TOTAL: '-1',
      TEKTON_PIPELINE_RUN: 'my-pipeline-run-42',
      TEKTON_COMMIT_SHA: 'tekton-commit-sha',
      TEKTON_BRANCH: 'tekton-branch'
    });
  });

  it('has the correct properties', () => {
    expect(env).toHaveProperty('ci', 'tekton');
    expect(env).toHaveProperty('commit', 'tekton-commit-sha');
    expect(env).toHaveProperty('branch', 'tekton-branch');
    expect(env).toHaveProperty('pullRequest', null);
    expect(env).toHaveProperty('parallel.nonce', 'my-pipeline-run-42');
    expect(env).toHaveProperty('parallel.total', -1);
  });

  it('has the correct properties for PR triggers', () => {
    env = new PercyEnv({ ...env.vars, TEKTON_PULL_REQUEST: '42' });
    expect(env).toHaveProperty('pullRequest', '42');
  });

  it('is not detected when TEKTON_PIPELINE_RUN is unset (opt-in)', () => {
    env = new PercyEnv({
      TEKTON_COMMIT_SHA: 'tekton-commit-sha',
      TEKTON_BRANCH: 'tekton-branch'
    });
    expect(env).toHaveProperty('ci', null);
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
