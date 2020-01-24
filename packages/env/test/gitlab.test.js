import expect from 'expect';
import PercyEnvironment from '../src';

describe('GitLab', () => {
  let env;

  beforeEach(() => {
    env = new PercyEnvironment({
      GITLAB_CI: 'true',
      CI_COMMIT_SHA: 'gitlab-commit-sha',
      CI_COMMIT_REF_NAME: 'gitlab-branch',
      CI_PIPELINE_ID: 'gitlab-job-id',
      CI_SERVER_VERSION: '8.14.3-ee'
    });
  });

  it('has the correct properties', () => {
    expect(env).toHaveProperty('ci', 'gitlab');
    expect(env).toHaveProperty('info', 'gitlab/8.14.3-ee');
    expect(env).toHaveProperty('commit', 'gitlab-commit-sha');
    expect(env).toHaveProperty('branch', 'gitlab-branch');
    expect(env).toHaveProperty('target.commit', null);
    expect(env).toHaveProperty('target.branch', null);
    expect(env).toHaveProperty('pullRequest', null);
    expect(env).toHaveProperty('parallel.nonce', 'gitlab-job-id');
    expect(env).toHaveProperty('parallel.total', null);
  });

  it('has the correct properties for PR builds', () => {
    env = new PercyEnvironment({ ...env.vars, CI_MERGE_REQUEST_IID: '2217' });
    expect(env).toHaveProperty('pullRequest', '2217');
    expect(env).toHaveProperty('branch', 'gitlab-branch');
    expect(env).toHaveProperty('commit', 'gitlab-commit-sha');
  });
});
