import expect from 'expect';
import PercyEnvironment from '../src';

describe('Netlify', () => {
  let env;

  beforeEach(() => {
    env = new PercyEnvironment({
      NETLIFY: 'true',
      COMMIT_REF: 'netlify-sha',
      HEAD: 'netlify-branch',
      PULL_REQUEST: 'true',
      REVIEW_ID: '123'
    });
  });

  it('has the correct properties', () => {
    expect(env).toHaveProperty('ci', 'netlify');
    expect(env).toHaveProperty('commit', 'netlify-sha');
    expect(env).toHaveProperty('branch', 'netlify-branch');
    expect(env).toHaveProperty('target.commit', null);
    expect(env).toHaveProperty('target.branch', null);
    expect(env).toHaveProperty('pullRequest', '123');
    expect(env).toHaveProperty('parallel.nonce', null);
    expect(env).toHaveProperty('parallel.total', null);
  });
});
