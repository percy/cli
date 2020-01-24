import expect from 'expect';
import PercyEnvironment from '../src';

describe('Drone', () => {
  let env;

  beforeEach(() => {
    env = new PercyEnvironment({
      DRONE: 'true',
      DRONE_COMMIT: 'drone-commit-sha',
      DRONE_BRANCH: 'drone-branch',
      DRONE_BUILD_NUMBER: 'drone-build-number',
      CI_PULL_REQUEST: '123'
    });
  });

  it('has the correct properties', () => {
    expect(env).toHaveProperty('ci', 'drone');
    expect(env).toHaveProperty('commit', 'drone-commit-sha');
    expect(env).toHaveProperty('branch', 'drone-branch');
    expect(env).toHaveProperty('target.commit', null);
    expect(env).toHaveProperty('target.branch', null);
    expect(env).toHaveProperty('pullRequest', '123');
    expect(env).toHaveProperty('parallel.nonce', 'drone-build-number');
    expect(env).toHaveProperty('parallel.total', null);
  });
});
