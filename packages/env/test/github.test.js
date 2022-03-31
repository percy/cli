import fs from 'fs';
import url from 'url';
import path from 'path';
import PercyEnv from '@percy/env';
import { github } from '@percy/env/utils';

const GITHUB_EVENT_PATH = path.join(path.dirname(
  url.fileURLToPath(import.meta.url)
), 'gh-event-file');

describe('GitHub', () => {
  let env;

  beforeEach(() => {
    delete github.payload;

    fs.writeFileSync(GITHUB_EVENT_PATH, JSON.stringify({
      pull_request: {
        number: 10,
        head: {
          sha: 'gh-commit-sha',
          ref: 'gh-branch-name'
        }
      }
    }));

    env = new PercyEnv({
      PERCY_PARALLEL_TOTAL: '-1',
      GITHUB_RUN_ID: 'job-id',
      GITHUB_ACTIONS: 'true',
      GITHUB_EVENT_PATH
    });
  });

  afterEach(() => {
    fs.unlinkSync(GITHUB_EVENT_PATH);
  });

  it('has the correct properties', () => {
    expect(env).toHaveProperty('ci', 'github');
    expect(env).toHaveProperty('info', 'github');
    expect(env).toHaveProperty('commit', 'gh-commit-sha');
    expect(env).toHaveProperty('branch', 'gh-branch-name');
    expect(env).toHaveProperty('target.commit', null);
    expect(env).toHaveProperty('target.branch', null);
    expect(env).toHaveProperty('pullRequest', 10);
    expect(env).toHaveProperty('parallel.nonce', 'job-id');
    expect(env).toHaveProperty('parallel.total', -1);
  });

  it('has env info for custom actions', () => {
    env.vars.PERCY_GITHUB_ACTION = 'custom-action/0.1.0';
    expect(env).toHaveProperty('info', 'github/custom-action/0.1.0');
  });

  describe('without an event payload', () => {
    beforeEach(() => {
      env = new PercyEnv({
        GITHUB_ACTIONS: 'true',
        GITHUB_SHA: 'gh-env-sha',
        GITHUB_REF: 'refs/head/gh-env-branch'
      });
    });

    it('has the correct properties based on env vars', () => {
      expect(env).toHaveProperty('ci', 'github');
      expect(env).toHaveProperty('info', 'github');
      expect(env).toHaveProperty('commit', 'gh-env-sha');
      expect(env).toHaveProperty('branch', 'gh-env-branch');
    });
  });
});
