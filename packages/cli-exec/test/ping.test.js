import { logger, setupTest, createTestServer } from '@percy/cli-command/test/helpers';
import { ping } from '@percy/cli-exec';

describe('percy exec:ping', () => {
  let percyServer;

  beforeEach(async () => {
    process.env.PERCY_TOKEN = '<<PERCY_TOKEN>>';
    process.env.PERCY_FORCE_PKG_VALUE = JSON.stringify({ name: '@percy/client', version: '1.0.0' });
    await setupTest();
  });

  afterEach(async () => {
    delete process.env.PERCY_TOKEN;
    delete process.env.PERCY_FORCE_PKG_VALUE;
    delete process.env.PERCY_ENABLE;
    delete process.env.PERCY_PARALLEL_TOTAL;
    delete process.env.PERCY_PARTIAL_BUILD;
    await percyServer?.close();
  });

  it('logs when percy is disabled', async () => {
    process.env.PERCY_ENABLE = '0';
    await ping();

    expect(logger.stdout).toEqual([]);
    expect(logger.stderr).toEqual(['[percy] Percy is disabled']);
  });

  it('calls the /percy/healthcheck endpoint and logs', async () => {
    percyServer = await createTestServer({
      '/percy/healthcheck': () => [200, 'application/json', { success: true }]
    }, 5338);

    await ping();

    expect(logger.stderr).toEqual([]);
    expect(logger.stdout).toEqual(['[percy] Percy is running']);
    expect(percyServer.requests.length).toEqual(1);
    expect(percyServer.requests[0][0]).toEqual('/percy/healthcheck');
  });

  it('can ping /percy/healthcheck at an alternate port', async () => {
    percyServer = await createTestServer({
      '/percy/healthcheck': () => [200, 'application/json', { success: true }]
    }, 4567);

    await ping(['--port=4567']);

    expect(logger.stderr).toEqual([]);
    expect(logger.stdout).toEqual(['[percy] Percy is running']);
    expect(percyServer.requests.length).toEqual(1);
    expect(percyServer.requests[0][0]).toEqual('/percy/healthcheck');
  });

  it('logs an error when the endpoint errors', async () => {
    await expectAsync(ping()).toBeRejected();

    expect(logger.stdout).toEqual([]);
    expect(logger.stderr).toEqual(['[percy] Percy is not running']);
  });
});
