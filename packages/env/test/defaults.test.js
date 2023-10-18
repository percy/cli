import { mockgit } from './helpers.js';
import PercyEnv from '@percy/env';

describe('Defaults', () => {
  let env;

  beforeEach(() => {
    env = new PercyEnv({});
  });

  it('has default properties', () => {
    expect(env).toHaveProperty('ci', null);
    expect(env).toHaveProperty('commit', null);
    expect(env).toHaveProperty('branch', null);
    expect(env).toHaveProperty('target.commit', null);
    expect(env).toHaveProperty('target.branch', null);
    expect(env).toHaveProperty('pullRequest', null);
    expect(env).toHaveProperty('parallel.nonce', null);
    expect(env).toHaveProperty('parallel.total', null);
    expect(env).toHaveProperty('partial', false);
    expect(env).toHaveProperty('token', null);
  });

  it('has default CI info', () => {
    env = new PercyEnv({ CI: 'true' });
    expect(env).toHaveProperty('ci', 'CI/unknown');
    expect(env).toHaveProperty('info', 'CI/unknown');
  });

  it('uses process.env as default vars', () => {
    expect(new PercyEnv()).toHaveProperty('vars', process.env);
  });

  it('reads and parses live git commit data', () => {
    let git = mockgit('mock-branch').and.returnValue([
      'COMMIT_SHA:mock sha',
      'AUTHOR_NAME:mock author',
      'AUTHOR_EMAIL:mock author@email.com',
      'COMMITTER_NAME:mock committer',
      'COMMITTER_EMAIL:mock committer@email.com',
      'COMMITTED_DATE:mock date',
      'COMMIT_MESSAGE:mock commit'
    ].join('\n'));

    expect(env.git).toHaveProperty('sha', 'mock sha');
    expect(env.git).toHaveProperty('branch', 'mock-branch');
    expect(env.git).toHaveProperty('authorName', 'mock author');
    expect(env.git).toHaveProperty('authorEmail', 'mock author@email.com');
    expect(env.git).toHaveProperty('committedAt', 'mock date');
    expect(env.git).toHaveProperty('committerName', 'mock committer');
    expect(env.git).toHaveProperty('committerEmail', 'mock committer@email.com');
    expect(env.git).toHaveProperty('message', 'mock commit');

    expect(git).toHaveBeenCalledWith('rev-parse', '--abbrev-ref', 'HEAD');
    expect(git).toHaveBeenCalledWith('show', 'HEAD', '--quiet', jasmine.stringMatching(/--format=.*/));
  });

  it('uses raw branch data when git commit data is missing', () => {
    let git = mockgit('mock-branch');

    expect(env.git).toHaveProperty('branch', 'mock-branch');

    expect(git).toHaveBeenCalledWith('rev-parse', '--abbrev-ref', 'HEAD');
  });

  it('uses the raw commit sha when the env sha is invalid', () => {
    mockgit().and.returnValue('COMMIT_SHA:fully-valid-git-sha\n');

    env = new PercyEnv({
      BITBUCKET_BUILD_NUMBER: 'bitbucket-build-number',
      BITBUCKET_COMMIT: 'bitbucket-commit-sha'
    });

    expect(env).toHaveProperty('ci', 'bitbucket');
    expect(env).toHaveProperty('commit', 'bitbucket-commit-sha');
    expect(env).toHaveProperty('git.sha', 'fully-valid-git-sha');
    expect(env).toHaveProperty('parallel.nonce', null);
  });

  it('can be overridden with PERCY env vars', () => {
    mockgit().and.returnValue([
      'COMMIT_SHA:mock sha',
      'AUTHOR_NAME:mock author',
      'AUTHOR_EMAIL:mock author@email.com',
      'COMMITTER_NAME:mock committer',
      'COMMITTER_EMAIL:mock committer@email.com',
      'COMMITTED_DATE:mock date',
      'COMMIT_MESSAGE:mock commit'
    ].join('\n'));

    env = new PercyEnv({
      PERCY_TOKEN: 'percy-token',
      PERCY_COMMIT: 'percy-40-character-commit-sha-aaaaaaaaaa',
      PERCY_BRANCH: 'percy-branch',
      PERCY_TARGET_BRANCH: 'percy-target-branch',
      PERCY_TARGET_COMMIT: 'percy-target-commit',
      PERCY_PULL_REQUEST: '123',
      PERCY_PARALLEL_NONCE: 'percy-nonce',
      PERCY_PARALLEL_TOTAL: '-1',
      PERCY_PARTIAL_BUILD: '1',
      PERCY_GIT_AUTHOR_NAME: 'percy git author',
      PERCY_GIT_AUTHOR_EMAIL: 'percy git author@email.com',
      PERCY_GIT_COMMIT_MESSAGE: 'percy git commit',
      PERCY_GIT_COMMITTER_NAME: 'percy git committer',
      PERCY_GIT_COMMITTER_EMAIL: 'percy git committer@email.com',
      PERCY_GIT_COMMITTED_DATE: 'percy git date'
    });

    expect(env).toHaveProperty('token', 'percy-token');
    expect(env).toHaveProperty('commit', 'percy-40-character-commit-sha-aaaaaaaaaa');
    expect(env).toHaveProperty('branch', 'percy-branch');
    expect(env).toHaveProperty('target.commit', 'percy-target-commit');
    expect(env).toHaveProperty('target.branch', 'percy-target-branch');
    expect(env).toHaveProperty('pullRequest', '123');
    expect(env).toHaveProperty('parallel.nonce', 'percy-nonce');
    expect(env).toHaveProperty('parallel.total', -1);
    expect(env).toHaveProperty('partial', true);
    expect(env).toHaveProperty('git.sha', 'percy-40-character-commit-sha-aaaaaaaaaa');
    expect(env).toHaveProperty('git.branch', 'percy-branch');
    expect(env).toHaveProperty('git.authorName', 'percy git author');
    expect(env).toHaveProperty('git.authorEmail', 'percy git author@email.com');
    expect(env).toHaveProperty('git.committerName', 'percy git committer');
    expect(env).toHaveProperty('git.committerEmail', 'percy git committer@email.com');
    expect(env).toHaveProperty('git.committedAt', 'percy git date');
    expect(env).toHaveProperty('git.message', 'percy git commit');
  });

  it('does not collect parallel nonce with invalid or no parallel total', () => {
    env = new PercyEnv({
      PERCY_PARALLEL_NONCE: 'percy-nonce',
      PERCY_PARALLEL_TOTAL: 'invalid'
    });

    expect(env).toHaveProperty('parallel.nonce', null);
    expect(env).toHaveProperty('parallel.total', null);

    env = new PercyEnv({
      PERCY_PARALLEL_NONCE: 'percy-nonce'
    });

    expect(env).toHaveProperty('parallel.nonce', null);
    expect(env).toHaveProperty('parallel.total', null);
  });

  it('falls back to GIT env vars with missing or invalid git commit data', () => {
    mockgit('mock branch').and.returnValue('invalid');

    env = new PercyEnv({
      PERCY_COMMIT: 'not-long-enough-sha',
      GIT_AUTHOR_NAME: 'git author',
      GIT_AUTHOR_EMAIL: 'git author@email.com',
      GIT_COMMIT_SHA: 'git commit',
      GIT_COMMIT_MESSAGE: 'git message',
      GIT_COMMITTER_NAME: 'git committer',
      GIT_COMMITTER_EMAIL: 'git committer@email.com',
      GIT_COMMITTED_DATE: 'git date'
    });

    expect(env).toHaveProperty('git.sha', 'git commit');
    expect(env).toHaveProperty('git.branch', 'mock branch');
    expect(env).toHaveProperty('git.authorName', 'git author');
    expect(env).toHaveProperty('git.authorEmail', 'git author@email.com');
    expect(env).toHaveProperty('git.committerName', 'git committer');
    expect(env).toHaveProperty('git.committerEmail', 'git committer@email.com');
    expect(env).toHaveProperty('git.committedAt', 'git date');
    expect(env).toHaveProperty('git.message', 'git message');
  });

  it('catches git errors, if there are any', () => {
    mockgit().and.throwError(new Error('test'));

    expect(env).toHaveProperty('git.sha', null);
  });

  describe('env PERCY_SKIP_GIT_CHECK', () => {
    beforeEach(() => {
      process.env.PERCY_SKIP_GIT_CHECK = true;
    });

    afterAll(() => {
      process.env.PERCY_SKIP_GIT_CHECK = false;
    });

    it('does not make git commands when set to true', () => {
      mockgit('mock branch').and.returnValue('');

      expect(env).toHaveProperty('git.sha', null);
    });
  });
});
