import { request } from '@percy/cli-command/utils';
import { logger, setupTest, api } from '@percy/cli-command/test/helpers';
import { start, ping } from '@percy/cli-exec';

describe('percy exec:start', () => {
  let started;

  function stop() {
    if (started) process.emit('SIGINT');
    let promise = started;
    started = null;
    return promise;
  }

  beforeEach(async () => {
    process.env.PERCY_TOKEN = '<<PERCY_TOKEN>>';

    // disabling as it increases spec time and logs system info
    process.env.PERCY_DISABLE_SYSTEM_MONITORING = 'true';
    process.env.PERCY_FORCE_PKG_VALUE = JSON.stringify({ name: '@percy/client', version: '1.0.0' });
    await setupTest();

    started = start(['--quiet']);
    started.then(() => (started = null));
    // wait until the process starts
    await new Promise(r => setTimeout(r, 1000));
    await ping();
  });

  afterEach(async () => {
    delete process.env.PERCY_TOKEN;
    delete process.env.PERCY_ENABLE;
    delete process.env.PERCY_PARALLEL_TOTAL;
    delete process.env.PERCY_PARTIAL_BUILD;
    delete process.env.PERCY_DISABLE_SYSTEM_MONITORING;

    // it's important that percy is still running or we terminate the test process
    if (started) process.emit('SIGTERM');
    await started;
  });

  describe('projectType is app', () => {
    const type = start.definition.percy.projectType;
    const logInfo = logger.loglevel();
    beforeAll(() => {
      start.definition.percy.projectType = 'app';
      logger.loglevel('debug');
      process.env.PERCY_LOGLEVEL = 'debug';
    });

    afterAll(() => {
      start.definition.percy.projectType = type;
      logger.loglevel(logInfo);
      logger.reset(true);
      delete process.env.PERCY_LOGLEVEL;
    });

    it('does not call override function', () => {
      expect(logger.stderr).toEqual(
        jasmine.arrayContaining([
          '[percy:cli] Skipping percy project attribute calculation'
        ])
      );
    });
  });

  it('starts a long-running percy process', async () => {
    let response = await request('http://localhost:5338/percy/healthcheck');
    expect(response).toHaveProperty('success', true);
  });

  it('can start on an alternate port', async () => {
    start(['--quiet', '--port=4567']);
    let response = await request('http://localhost:4567/percy/healthcheck');
    expect(response).toHaveProperty('success', true);
  });

  it('stops the process when terminated', async () => {
    await expectAsync(
      request('http://localhost:5338/percy/healthcheck')
    ).toBeResolved();

    process.emit('SIGTERM');

    // check a few times rather than wait on a timeout to be deterministic
    await expectAsync(function check(i = 0) {
      return request('http://localhost:5338/percy/healthcheck', { timeout: 10 })
        .then(r => i >= 10 ? r : new Promise((res, rej) => {
          setTimeout(() => check(i++).then(res, rej), 100);
        }));
    }()).toBeRejectedWithError();
  });

  it('logs an error when percy is already running', async () => {
    logger.reset();

    await expectAsync(start()).toBeRejected();

    expect(logger.stdout).toEqual(jasmine.arrayContaining([
      "[percy] Build's CLI and CI logs sent successfully. Please share this log ID with Percy team in case of any issues - random_sha"
    ]));

    let lastReq = api.requests['/suggestions/from_logs'].length - 1;

    expect(api.requests['/suggestions/from_logs'][lastReq].body).toEqual({
      data: {
        logs: [
          { message: 'Percy is already running or the port 5338 is in use' }
        ]
      }
    });

    expect(logger.stderr).toEqual(jasmine.arrayContaining([
      '[percy] Notice: Percy collects CI logs to improve service and enhance your experience. These logs help us debug issues and provide insights on your dashboards, making it easier to optimize the product experience. Logs are stored securely for 30 days. You can opt out anytime with export PERCY_CLIENT_ERROR_LOGS=false, but keeping this enabled helps us offer the best support and features.',
      '[percy] Error: Percy is already running or the port 5338 is in use',
      '[percy] Error: Percy is already running or the port 5338 is in use'
    ]));
  });

  it('logs when percy has been disabled', async () => {
    await stop();
    logger.reset();

    process.env.PERCY_ENABLE = '0';
    process.env.PERCY_FORCE_PKG_VALUE = JSON.stringify({ name: '@percy/client', version: '1.0.0' });
    await start();

    expect(logger.stdout).toEqual([]);
    expect(logger.stderr).toEqual([
      '[percy] Percy is disabled'
    ]);
  });
});
