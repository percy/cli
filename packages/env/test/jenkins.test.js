import { mockgit } from './helpers';
import PercyEnv from '../src';

describe('Jenkins', () => {
  let env;

  beforeEach(() => {
    env = new PercyEnv({
      JENKINS_URL: 'http://jenkins.local/',
      GIT_COMMIT: 'jenkins-commit-sha',
      GIT_BRANCH: 'jenkins-branch',
      BUILD_TAG: 'xxxx-project-branch-build-number-123',
      PERCY_PARALLEL_TOTAL: '-1'
    });
  });

  it('has the correct properties', () => {
    expect(env).toHaveProperty('ci', 'jenkins');
    expect(env).toHaveProperty('commit', 'jenkins-commit-sha');
    expect(env).toHaveProperty('branch', 'jenkins-branch');
    expect(env).toHaveProperty('target.commit', null);
    expect(env).toHaveProperty('target.branch', null);
    expect(env).toHaveProperty('pullRequest', null);
    expect(env).toHaveProperty('parallel.nonce', '321-rebmun-dliub-hcnarb-tcejorp-xxxx');
    expect(env).toHaveProperty('parallel.total', -1);
  });

  it('has the correct properties for PR builds', () => {
    env = new PercyEnv({
      ...env.vars,
      CHANGE_ID: '111',
      CHANGE_BRANCH: 'jenkins-branch'
    });

    expect(env).toHaveProperty('pullRequest', '111');
    expect(env).toHaveProperty('branch', 'jenkins-branch');
  });

  it('has the correct properties for merge PR builds', () => {
    env = new PercyEnv({
      ...env.vars,
      CHANGE_ID: '111',
      CHANGE_BRANCH: 'jenkins-branch'
    });

    mockgit.commit.and.callFake(([, sha]) => [
      `COMMIT_SHA:${sha === 'HEAD' ? 'jenkins-merge-sha' : 'jenkins-non-merge-sha'}`,
      `AUTHOR_NAME:${sha === 'HEAD' ? 'Jenkins' : 'mock author'}`,
      `AUTHOR_EMAIL:${sha === 'HEAD' ? 'nobody@nowhere' : 'mock author@email.com'}`,
      `COMMIT_MESSAGE:${sha === 'HEAD' ? 'Merge commit test into HEAD' : 'mock commit'}`
    ].join('\n'));

    expect(env).toHaveProperty('pullRequest', '111');
    expect(env).toHaveProperty('branch', 'jenkins-branch');
    expect(env).toHaveProperty('commit', 'jenkins-non-merge-sha');
    expect(env).toHaveProperty('git.authorName', 'mock author');
    expect(env).toHaveProperty('git.authorEmail', 'mock author@email.com');
    expect(env).toHaveProperty('git.message', 'mock commit');
  });

  describe('with the PRB plugin', () => {
    beforeEach(() => {
      env = new PercyEnv({
        JENKINS_URL: 'http://jenkins.local/',
        BUILD_NUMBER: '111',
        ghprbPullId: '256',
        ghprbActualCommit: 'jenkins-prb-commit-sha',
        ghprbSourceBranch: 'jenkins-prb-branch',
        PERCY_PARALLEL_TOTAL: '-1'
      });
    });

    it('has the correct properties', () => {
      expect(env).toHaveProperty('ci', 'jenkins-prb');
      expect(env).toHaveProperty('commit', 'jenkins-prb-commit-sha');
      expect(env).toHaveProperty('branch', 'jenkins-prb-branch');
      expect(env).toHaveProperty('target.commit', null);
      expect(env).toHaveProperty('target.branch', null);
      expect(env).toHaveProperty('pullRequest', '256');
      expect(env).toHaveProperty('parallel.nonce', '111');
      expect(env).toHaveProperty('parallel.total', -1);
    });

    it('has the correct fallback when PRB commit var is missing', () => {
      env.vars.GIT_COMMIT = env.vars.ghprbActualCommit;
      env.vars.ghprbActualCommit = null;

      expect(env).toHaveProperty('commit', 'jenkins-prb-commit-sha');
    });
  });
});
