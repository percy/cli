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
      SEMAPHORE_THREAD_COUNT: '2',
      PULL_REQUEST_NUMBER: '123'
    });
  });

  it('has the correct properties', () => {
    expect(env).toHaveProperty('ci', 'semaphore');
    expect(env).toHaveProperty('commit', 'semaphore-commit-sha');
    expect(env).toHaveProperty('branch', 'semaphore-branch');
    expect(env).toHaveProperty('target.commit', null);
    expect(env).toHaveProperty('target.branch', null);
    expect(env).toHaveProperty('pullRequest', '123');
    expect(env).toHaveProperty('parallel.nonce', 'semaphore-branch-id/semaphore-build-number');
    expect(env).toHaveProperty('parallel.total', 2);
  });
});
