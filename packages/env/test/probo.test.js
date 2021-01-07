import expect from 'expect';
import PercyEnvironment from '../src';

describe('Probo', () => {
  let env;

  beforeEach(() => {
    env = new PercyEnvironment({
      PROBO_ENVIRONMENT: 'TRUE',
      BUILD_ID: 'probo-build-id',
      COMMIT_REF: 'probo-commit-sha',
      BRANCH_NAME: 'probo-branch',
      PULL_REQUEST_LINK: 'https://github.com/owner/repo-name/pull/123',
      PERCY_PARALLEL_TOTAL: '-1'
    });
  });

  it('has the correct properties', () => {
    expect(env).toHaveProperty('ci', 'probo');
    expect(env).toHaveProperty('commit', 'probo-commit-sha');
    expect(env).toHaveProperty('branch', 'probo-branch');
    expect(env).toHaveProperty('target.commit', null);
    expect(env).toHaveProperty('target.branch', null);
    expect(env).toHaveProperty('pullRequest', '123');
    expect(env).toHaveProperty('parallel.nonce', 'probo-build-id');
    expect(env).toHaveProperty('parallel.total', -1);
  });
});
