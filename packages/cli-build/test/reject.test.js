import { logger, setupTest } from '@percy/cli-command/test/helpers';
import api from '@percy/client/test/helpers';
import { reject } from '@percy/cli-build';

describe('percy build:reject', () => {
  let successResponse = {
    data: {
      attributes: {
        action: 'approve',
        'latest-action-performed-by': {
          user_email: 'test@test.com',
          user_name: 'testuser'
        }
      }
    }
  };

  beforeEach(async () => {
    await setupTest();
  });

  afterEach(() => {
    delete process.env.PERCY_ENABLE;
    delete process.env.BROWSERSTACK_USERNAME;
    delete process.env.BROWSERSTACK_ACCESS_KEY;
    delete process.env.PERCY_TOKEN;
    delete process.env.PERCY_FORCE_PKG_VALUE;
  });

  it('does nothing and logs when percy is not enabled', async () => {
    process.env.PERCY_ENABLE = '0';
    await reject(['123']);

    expect(logger.stdout).toEqual([]);
    expect(logger.stderr).toEqual([
      '[percy] Percy is disabled'
    ]);
  });

  it('logs an error when build ID is not provided', async () => {
    process.env.PERCY_TOKEN = '<<PERCY_TOKEN>>';
    process.env.PERCY_FORCE_PKG_VALUE = JSON.stringify({ name: '@percy/client', version: '1.0.0' });
    await expectAsync(reject([])).toBeRejected();

    expect(logger.stdout).toEqual([]);
    expect(logger.stderr).toEqual([
      "[percy] ParseError: Missing required argument 'build-id'"
    ]);
  });

  it('logs an error when username is missing', async () => {
    process.env.PERCY_TOKEN = '<<PERCY_TOKEN>>';
    process.env.PERCY_FORCE_PKG_VALUE = JSON.stringify({ name: '@percy/client', version: '1.0.0' });
    process.env.BROWSERSTACK_ACCESS_KEY = 'test-access-key';
    await expectAsync(reject(['123'])).toBeRejected();

    expect(logger.stdout).toEqual([]);
    expect(logger.stderr).toEqual([
      '[percy] Error: Username and access key are required to reject builds.'
    ]);
  });

  it('logs an error when access key is missing', async () => {
    process.env.PERCY_TOKEN = '<<PERCY_TOKEN>>';
    process.env.PERCY_FORCE_PKG_VALUE = JSON.stringify({ name: '@percy/client', version: '1.0.0' });
    process.env.BROWSERSTACK_USERNAME = 'test-username';
    await expectAsync(reject(['123'])).toBeRejected();

    expect(logger.stdout).toEqual([]);
    expect(logger.stderr).toEqual([
      '[percy] Error: Username and access key are required to reject builds.'
    ]);
  });

  it('logs an error when both username and access key are missing', async () => {
    process.env.PERCY_TOKEN = '<<PERCY_TOKEN>>';
    process.env.PERCY_FORCE_PKG_VALUE = JSON.stringify({ name: '@percy/client', version: '1.0.0' });
    await expectAsync(reject(['123'])).toBeRejected();

    expect(logger.stdout).toEqual([]);
    expect(logger.stderr).toEqual([
      '[percy] Error: Username and access key are required to reject builds.'
    ]);
  });

  it('uses username and access key from environment variables', async () => {
    process.env.PERCY_TOKEN = '<<PERCY_TOKEN>>';
    process.env.PERCY_FORCE_PKG_VALUE = JSON.stringify({ name: '@percy/client', version: '1.0.0' });
    process.env.BROWSERSTACK_USERNAME = 'env-username';
    process.env.BROWSERSTACK_ACCESS_KEY = 'env-access-key';

    api.reply('/reviews', (req) => {
      expect(req.body).toEqual({
        data: {
          type: 'reviews',
          attributes: {
            action: 'reject'
          },
          relationships: {
            build: {
              data: {
                type: 'builds',
                id: '123'
              }
            }
          }
        }
      });
      expect(req.headers['bstack-username']).toEqual('env-username');
      expect(req.headers['bstack-access-key']).toEqual('env-access-key');
      return [200, successResponse];
    });

    await reject(['123']);

    expect(logger.stderr).toEqual([]);
    expect(logger.stdout).toEqual([
      '[percy] Rejecting build 123...',
      '[percy] Build 123 rejected successfully!',
      '[percy] Rejected by: testuser (test@test.com)'
    ]);
  });

  it('doesnot require percy token', async () => {
    process.env.PERCY_FORCE_PKG_VALUE = JSON.stringify({ name: '@percy/client', version: '1.0.0' });
    process.env.BROWSERSTACK_USERNAME = 'env-username';
    process.env.BROWSERSTACK_ACCESS_KEY = 'env-access-key';

    api.reply('/reviews', (req) => [200, successResponse]);

    await reject(['123']);

    expect(logger.stderr).toEqual([]);
    expect(logger.stdout).toEqual([
      '[percy] Rejecting build 123...',
      '[percy] Build 123 rejected successfully!',
      '[percy] Rejected by: testuser (test@test.com)'
    ]);
  });

  it('uses username and access key from flags over environment variables', async () => {
    process.env.PERCY_TOKEN = '<<PERCY_TOKEN>>';
    process.env.PERCY_FORCE_PKG_VALUE = JSON.stringify({ name: '@percy/client', version: '1.0.0' });
    process.env.BROWSERSTACK_USERNAME = 'env-username';
    process.env.BROWSERSTACK_ACCESS_KEY = 'env-access-key';

    api.reply('/reviews', (req) => {
      expect(req.headers['bstack-username']).toEqual('flag-username');
      expect(req.headers['bstack-access-key']).toEqual('flag-access-key');
      return [200, successResponse];
    });

    await reject(['123', '--username=flag-username', '--access-key=flag-access-key']);

    expect(logger.stderr).toEqual([]);
    expect(logger.stdout).toEqual([
      '[percy] Rejecting build 123...',
      '[percy] Build 123 rejected successfully!',
      '[percy] Rejected by: testuser (test@test.com)'
    ]);
  });

  it('handles mixed flag and environment variable usage', async () => {
    process.env.PERCY_TOKEN = '<<PERCY_TOKEN>>';
    process.env.PERCY_FORCE_PKG_VALUE = JSON.stringify({ name: '@percy/client', version: '1.0.0' });
    process.env.BROWSERSTACK_USERNAME = 'env-username';
    // Only access key from flag

    api.reply('/reviews', (req) => {
      expect(req.headers['bstack-username']).toEqual('env-username');
      expect(req.headers['bstack-access-key']).toEqual('flag-access-key');
      return [200, successResponse];
    });

    await reject(['123', '--access-key=flag-access-key']);

    expect(logger.stderr).toEqual([]);
    expect(logger.stdout).toEqual([
      '[percy] Rejecting build 123...',
      '[percy] Build 123 rejected successfully!',
      '[percy] Rejected by: testuser (test@test.com)'
    ]);
  });

  it('handles username from flag and access key from environment', async () => {
    process.env.PERCY_TOKEN = '<<PERCY_TOKEN>>';
    process.env.PERCY_FORCE_PKG_VALUE = JSON.stringify({ name: '@percy/client', version: '1.0.0' });
    process.env.BROWSERSTACK_ACCESS_KEY = 'env-access-key';
    // Only username from flag

    api.reply('/reviews', (req) => {
      expect(req.body).toEqual({
        data: {
          type: 'reviews',
          attributes: {
            action: 'reject'
          },
          relationships: {
            build: {
              data: {
                type: 'builds',
                id: '123'
              }
            }
          }
        }
      });
      expect(req.headers['bstack-username']).toEqual('flag-username');
      expect(req.headers['bstack-access-key']).toEqual('env-access-key');
      return [200, successResponse];
    });

    await reject(['123', '--username=flag-username']);

    expect(logger.stderr).toEqual([]);
    expect(logger.stdout).toEqual([
      '[percy] Rejecting build 123...',
      '[percy] Build 123 rejected successfully!',
      '[percy] Rejected by: testuser (test@test.com)'
    ]);
  });

  it('logs an error when build approval fails with 401 Unauthorized', async () => {
    process.env.PERCY_TOKEN = '<<PERCY_TOKEN>>';
    process.env.PERCY_FORCE_PKG_VALUE = JSON.stringify({ name: '@percy/client', version: '1.0.0' });
    process.env.BROWSERSTACK_USERNAME = 'invalid-username';
    process.env.BROWSERSTACK_ACCESS_KEY = 'invalid-access-key';

    api.reply('/reviews', (req) => {
      expect(req.body).toEqual({
        data: {
          type: 'reviews',
          attributes: {
            action: 'reject'
          },
          relationships: {
            build: {
              data: {
                type: 'builds',
                id: '123'
              }
            }
          }
        }
      });
      expect(req.headers['bstack-username']).toEqual('invalid-username');
      expect(req.headers['bstack-access-key']).toEqual('invalid-access-key');
      return [401, { errors: [{ detail: 'Unauthorized' }] }];
    });

    await expectAsync(reject(['123'])).toBeRejected();

    expect(logger.stderr).toEqual([
      '[percy] Failed to reject build 123',
      '[percy] Error: Unauthorized',
      '[percy] Error: Failed to reject the build'
    ]);
  });

  it('logs an error when build approval fails with 403 Forbidden', async () => {
    process.env.PERCY_TOKEN = '<<PERCY_TOKEN>>';
    process.env.PERCY_FORCE_PKG_VALUE = JSON.stringify({ name: '@percy/client', version: '1.0.0' });
    process.env.BROWSERSTACK_USERNAME = 'test-username';
    process.env.BROWSERSTACK_ACCESS_KEY = 'test-access-key';

    api.reply('/reviews', (req) => {
      expect(req.body).toEqual({
        data: {
          type: 'reviews',
          attributes: {
            action: 'reject'
          },
          relationships: {
            build: {
              data: {
                type: 'builds',
                id: '123'
              }
            }
          }
        }
      });
      return [403, { errors: [{ detail: 'Forbidden' }] }];
    });

    await expectAsync(reject(['123'])).toBeRejected();

    expect(logger.stderr).toEqual([
      '[percy] Failed to reject build 123',
      '[percy] Error: Forbidden',
      '[percy] Error: Failed to reject the build'
    ]);
  });
});
