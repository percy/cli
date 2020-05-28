import expect from 'expect';
import mockgit from './mockgit';
import PercyEnvironment from '../src';

describe('Defaults', () => {
  let env;

  beforeEach(() => {
    env = new PercyEnvironment({});
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
    env = new PercyEnvironment({ CI: 'true' });
    expect(env).toHaveProperty('ci', 'CI/unknown');
    expect(env).toHaveProperty('info', 'CI/unknown');
  });

  it('uses process.env as default vars', () => {
    expect(new PercyEnvironment()).toHaveProperty('vars', process.env);
  });

  it('reads and parses live git commit data', () => {
    mockgit.branch(() => 'mock-branch');

    mockgit.commit(() => [
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

    expect(mockgit.branch.calls).toHaveLength(1);
    expect(mockgit.branch.calls[0]).toEqual(['rev-parse', '--abbrev-ref', 'HEAD']);
    expect(mockgit.commit.calls).toHaveLength(1);
    expect(mockgit.commit.calls[0])
      .toEqual(['show', 'HEAD', '--quiet', expect.stringMatching(/--format=.*/)]);
  });

  it('uses raw branch data when git commit data is missing', () => {
    mockgit.branch(args => 'mock-branch');

    expect(env.git).toHaveProperty('branch', 'mock-branch');

    expect(mockgit.branch.calls).toHaveLength(1);
    expect(mockgit.branch.calls[0]).toEqual(['rev-parse', '--abbrev-ref', 'HEAD']);
  });

  it('can be overridden with PERCY env vars', () => {
    mockgit.commit(() => [
      'COMMIT_SHA:mock sha',
      'AUTHOR_NAME:mock author',
      'AUTHOR_EMAIL:mock author@email.com',
      'COMMITTER_NAME:mock committer',
      'COMMITTER_EMAIL:mock committer@email.com',
      'COMMITTED_DATE:mock date',
      'COMMIT_MESSAGE:mock commit'
    ].join('\n'));

    env = new PercyEnvironment({
      PERCY_TOKEN: 'percy-token',
      PERCY_COMMIT: 'percy-commit',
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
    expect(env).toHaveProperty('commit', 'percy-commit');
    expect(env).toHaveProperty('branch', 'percy-branch');
    expect(env).toHaveProperty('target.commit', 'percy-target-commit');
    expect(env).toHaveProperty('target.branch', 'percy-target-branch');
    expect(env).toHaveProperty('pullRequest', '123');
    expect(env).toHaveProperty('parallel.nonce', 'percy-nonce');
    expect(env).toHaveProperty('parallel.total', -1);
    expect(env).toHaveProperty('partial', true);
    expect(env).toHaveProperty('git.sha', 'percy-commit');
    expect(env).toHaveProperty('git.branch', 'percy-branch');
    expect(env).toHaveProperty('git.authorName', 'percy git author');
    expect(env).toHaveProperty('git.authorEmail', 'percy git author@email.com');
    expect(env).toHaveProperty('git.committerName', 'percy git committer');
    expect(env).toHaveProperty('git.committerEmail', 'percy git committer@email.com');
    expect(env).toHaveProperty('git.committedAt', 'percy git date');
    expect(env).toHaveProperty('git.message', 'percy git commit');
  });

  it('falls back to GIT env vars when missing git commit data', () => {
    mockgit.commit(() => 'invalid or missing');

    env = new PercyEnvironment({
      GIT_AUTHOR_NAME: 'git author',
      GIT_AUTHOR_EMAIL: 'git author@email.com',
      GIT_COMMIT_MESSAGE: 'git commit',
      GIT_COMMITTER_NAME: 'git committer',
      GIT_COMMITTER_EMAIL: 'git committer@email.com',
      GIT_COMMITTED_DATE: 'git date'
    });

    expect(env).toHaveProperty('git.sha', null);
    expect(env).toHaveProperty('git.branch', null);
    expect(env).toHaveProperty('git.authorName', 'git author');
    expect(env).toHaveProperty('git.authorEmail', 'git author@email.com');
    expect(env).toHaveProperty('git.committerName', 'git committer');
    expect(env).toHaveProperty('git.committerEmail', 'git committer@email.com');
    expect(env).toHaveProperty('git.committedAt', 'git date');
    expect(env).toHaveProperty('git.message', 'git commit');
  });
});
