import expect from 'expect';
import PercyEnvironment from '../src';

describe('Semaphore', () => {
  let env;

  beforeEach(() => {
    env = new PercyEnvironment({
      SEMAPHORE: 'true',
      BRANCH_NAME: 'semaphore-branch',
      REVISION: 'semaphore-commit-sha',
      SEMAPHORE_BRANCH_ID: 'semaphore-branch-id',
      SEMAPHORE_BUILD_NUMBER: 'semaphore-build-number',
      PULL_REQUEST_NUMBER: '123'
    });
  });

  it('has the correct properties', () => {
    expect(env).toHaveProperty('ci', 'semaphore');
    expect(env).toHaveProperty('info', 'semaphore');
    expect(env).toHaveProperty('commit', 'semaphore-commit-sha');
    expect(env).toHaveProperty('branch', 'semaphore-branch');
    expect(env).toHaveProperty('target.commit', null);
    expect(env).toHaveProperty('target.branch', null);
    expect(env).toHaveProperty('pullRequest', '123');
    expect(env).toHaveProperty('parallel.nonce', 'semaphore-branch-id/semaphore-build-number');
    expect(env).toHaveProperty('parallel.total', null);
  });

  describe('Semaphore 2.0', () => {
    beforeEach(() => {
      env = new PercyEnvironment({
        SEMAPHORE: 'true',
        SEMAPHORE_GIT_SHA: 'semaphore-2-sha',
        SEMAPHORE_GIT_BRANCH: 'semaphore-2-branch',
        SEMAPHORE_WORKFLOW_ID: 'semaphore-2-workflow-id'
      });
    });

    it('has the correct properties', () => {
      expect(env).toHaveProperty('ci', 'semaphore');
      expect(env).toHaveProperty('info', 'semaphore/2.0');
      expect(env).toHaveProperty('commit', 'semaphore-2-sha');
      expect(env).toHaveProperty('branch', 'semaphore-2-branch');
      expect(env).toHaveProperty('target.commit', null);
      expect(env).toHaveProperty('target.branch', null);
      expect(env).toHaveProperty('pullRequest', null);
      expect(env).toHaveProperty('parallel.nonce', 'semaphore-2-workflow-id');
      expect(env).toHaveProperty('parallel.total', null);
    });

    it('has the correct properties for PR builds', () => {
      env = new PercyEnvironment({
        SEMAPHORE: 'true',
        SEMAPHORE_GIT_SHA: 'semaphore-2-sha',
        SEMAPHORE_GIT_PR_SHA: 'semaphore-2-pr-sha',
        SEMAPHORE_GIT_BRANCH: 'semaphore-2-branch',
        SEMAPHORE_GIT_PR_BRANCH: 'semaphore-2-pr-branch',
        SEMAPHORE_GIT_PR_NUMBER: '50',
        SEMAPHORE_WORKFLOW_ID: 'semaphore-2-workflow-id'
      });

      expect(env).toHaveProperty('ci', 'semaphore');
      expect(env).toHaveProperty('info', 'semaphore/2.0');
      expect(env).toHaveProperty('commit', 'semaphore-2-pr-sha');
      expect(env).toHaveProperty('branch', 'semaphore-2-pr-branch');
      expect(env).toHaveProperty('target.commit', null);
      expect(env).toHaveProperty('target.branch', null);
      expect(env).toHaveProperty('pullRequest', '50');
      expect(env).toHaveProperty('parallel.nonce', 'semaphore-2-workflow-id');
      expect(env).toHaveProperty('parallel.total', null);
    });
  });
});
