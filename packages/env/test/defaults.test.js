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

  describe('with PERCY and GIT env vars', () => {
    beforeEach(() => {
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
        GIT_AUTHOR_NAME: 'git author',
        GIT_AUTHOR_EMAIL: 'git author@email.com',
        GIT_COMMIT_MESSAGE: 'git commit',
        GIT_COMMITTER_NAME: 'git committer',
        GIT_COMMITTER_EMAIL: 'git committer@email.com',
        GIT_COMMITTED_DATE: 'git date'
      });
    });

    it('overrides with PERCY env vars', () => {
      expect(env).toHaveProperty('token', 'percy-token');
      expect(env).toHaveProperty('commit', 'percy-commit');
      expect(env).toHaveProperty('branch', 'percy-branch');
      expect(env).toHaveProperty('target.commit', 'percy-target-commit');
      expect(env).toHaveProperty('target.branch', 'percy-target-branch');
      expect(env).toHaveProperty('pullRequest', '123');
      expect(env).toHaveProperty('parallel.nonce', 'percy-nonce');
      expect(env).toHaveProperty('parallel.total', -1);
      expect(env).toHaveProperty('partial', true);
    });

    it('uses GIT env vars when missing git commit data', () => {
      mockgit.commit(() => 'invalid'); // todo - this is for coverage... need different test?
      expect(env.git).toHaveProperty('sha', 'percy-commit');
      expect(env.git).toHaveProperty('branch', 'percy-branch');
      expect(env.git).toHaveProperty('authorName', 'git author');
      expect(env.git).toHaveProperty('authorEmail', 'git author@email.com');
      expect(env.git).toHaveProperty('committerName', 'git committer');
      expect(env.git).toHaveProperty('committerEmail', 'git committer@email.com');
      expect(env.git).toHaveProperty('committedAt', 'git date');
      expect(env.git).toHaveProperty('message', 'git commit');
    });
  });
});
