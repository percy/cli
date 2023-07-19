import { request } from '@percy/cli-command/utils';
import { logger, setupTest } from '@percy/cli-command/test/helpers';
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
    await setupTest();

    started = start(['--quiet']);
    started.then(() => (started = null));
    await ping();
  });

  afterEach(async () => {
    delete process.env.PERCY_TOKEN;
    delete process.env.PERCY_ENABLE;
    delete process.env.PERCY_PARALLEL_TOTAL;
    delete process.env.PERCY_PARTIAL_BUILD;

    // it's important that percy is still running or we terminate the test process
    if (started) process.emit('SIGTERM');
    await started;
  });

  it('calls percy project attribute calculation', async () => {
    expect(logger.stdout[0]).toEqual(
      '[percy] Percy project attribute calculation'
    );
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

    expect(logger.stdout).toEqual([]);
    expect(logger.stderr).toEqual([
      '[percy] Error: Percy is already running or the port is in use'
    ]);
  });

  it('logs when percy has been disabled', async () => {
    await stop();
    logger.reset();

    process.env.PERCY_ENABLE = '0';
    await start();

    expect(logger.stdout).toEqual([]);
    expect(logger.stderr).toEqual([
      '[percy] Percy is disabled'
    ]);
  });
});
