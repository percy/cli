import { request } from '@percy/core/dist/utils';
import { logger } from './helpers';
import start from '../src/start';
import ping from '../src/ping';

describe('percy exec:start', () => {
  let started;

  function stop() {
    if (started) process.emit('SIGINT');
    let promise = started;
    started = null;
    return promise;
  }

  beforeEach(async () => {
    started = start(['--quiet']);
    started.then(() => (started = null));
    await ping();
  });

  afterEach(async () => {
    // it's important that percy is still running or we terminate the test process
    if (started) process.emit('SIGTERM');
    await started;
  });

  it('starts a long-running percy process', async () => {
    let response = await request('http://localhost:5338/percy/healthcheck');
    expect(response).toHaveProperty('success', true);
  });

  it('can start on an alternate port', async () => {
    start(['--quiet', '--port=1234']);
    let response = await request('http://localhost:1234/percy/healthcheck');
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
