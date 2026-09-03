import PercyEnv from '@percy/env';

describe('Argo Workflows', () => {
  let env;

  beforeEach(() => {
    env = new PercyEnv({
      PERCY_PARALLEL_TOTAL: '-1',
      ARGO_WORKFLOW_NAME: 'my-workflow-42',
      ARGO_WORKFLOW_UID: 'argo-uid-xyz',
      ARGO_COMMIT_SHA: 'argo-commit-sha',
      ARGO_BRANCH: 'argo-branch'
    });
  });

  it('has the correct properties', () => {
    expect(env).toHaveProperty('ci', 'argo-workflows');
    expect(env).toHaveProperty('commit', 'argo-commit-sha');
    expect(env).toHaveProperty('branch', 'argo-branch');
    expect(env).toHaveProperty('pullRequest', null);
    expect(env).toHaveProperty('parallel.nonce', 'argo-uid-xyz');
    expect(env).toHaveProperty('parallel.total', -1);
  });

  it('has the correct properties for PR triggers', () => {
    env = new PercyEnv({ ...env.vars, ARGO_PULL_REQUEST: '42' });
    expect(env).toHaveProperty('pullRequest', '42');
  });

  it('falls back to workflow name when UID is absent', () => {
    env = new PercyEnv({ ...env.vars, ARGO_WORKFLOW_UID: undefined });
    expect(env).toHaveProperty('parallel.nonce', 'my-workflow-42');
  });

  it('is not detected when ARGO_WORKFLOW_NAME is unset (opt-in)', () => {
    env = new PercyEnv({
      ARGO_WORKFLOW_UID: 'argo-uid-xyz',
      ARGO_COMMIT_SHA: 'argo-commit-sha'
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
