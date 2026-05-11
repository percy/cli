import PercyEnv from '@percy/env';

describe('Cloudflare Pages', () => {
  let env;

  beforeEach(() => {
    env = new PercyEnv({
      PERCY_PARALLEL_TOTAL: '-1',
      CF_PAGES: '1',
      CF_PAGES_COMMIT_SHA: 'cf-commit-sha',
      CF_PAGES_BRANCH: 'cf-branch',
      CF_PAGES_URL: 'https://abc123.my-project.pages.dev'
    });
  });

  it('has the correct properties', () => {
    expect(env).toHaveProperty('ci', 'cloudflare-pages');
    expect(env).toHaveProperty('commit', 'cf-commit-sha');
    expect(env).toHaveProperty('branch', 'cf-branch');
    // Cloudflare Pages does not natively expose PR info
    expect(env).toHaveProperty('pullRequest', null);
    // Nonce is commit SHA alone — earlier composite (commit + URL) exceeded
    // Percy's 64-char nonce limit and caused build creation to fail.
    expect(env).toHaveProperty('parallel.nonce', 'cf-commit-sha');
    expect(env).toHaveProperty('parallel.total', -1);
  });

  it('returns null nonce when CF_PAGES_COMMIT_SHA is absent (never emits "undefined")', () => {
    env = new PercyEnv({
      PERCY_PARALLEL_TOTAL: '-1',
      CF_PAGES: '1',
      CF_PAGES_BRANCH: 'cf-branch',
      CF_PAGES_URL: 'https://abc123.my-project.pages.dev'
    });
    expect(env).toHaveProperty('parallel.nonce', null);
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
