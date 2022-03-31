import { logger, setupTest, createTestServer } from '@percy/cli-command/test/helpers';
import { stop } from '@percy/cli-exec';

describe('percy exec:stop', () => {
  let percyServer;

  beforeEach(async () => {
    process.env.PERCY_TOKEN = '<<PERCY_TOKEN>>';
    await setupTest();
  });

  afterEach(async () => {
    delete process.env.PERCY_TOKEN;
    delete process.env.PERCY_ENABLE;
    delete process.env.PERCY_PARALLEL_TOTAL;
    delete process.env.PERCY_PARTIAL_BUILD;
    await percyServer?.close();
  });

  it('calls the /percy/stop endpoint and logs after the server goes down', async () => {
    percyServer = await createTestServer({
      '/percy/stop': () => [200, 'application/json', { success: true }]
    }, 5338);

    await stop();

    expect(percyServer.requests).toEqual([
      ['/percy/stop'],
      ['/percy/healthcheck']
    ]);

    expect(logger.stderr).toEqual([]);
    expect(logger.stdout).toEqual(['[percy] Percy has stopped']);
  });

  it('waits for the /percy/healthcheck endpoint to fail', async () => {
    let check = 0;

    percyServer = await createTestServer({
      '/percy/stop': () => [200, 'application/json', { success: true }],
      '/percy/healthcheck': () => ++check === 2
        ? [400, 'application/json', { success: false }]
        : [200, 'application/json', { success: true }]
    }, 5338);

    await stop();
    expect(check).toEqual(2);
  });

  it('can stop a server on another port', async () => {
    percyServer = await createTestServer({
      '/percy/stop': () => [200, 'application/json', { success: true }]
    }, 4567);

    await stop(['--port=4567']);

    expect(percyServer.requests).toEqual([
      ['/percy/stop'],
      ['/percy/healthcheck']
    ]);

    expect(logger.stderr).toEqual([]);
    expect(logger.stdout).toEqual(['[percy] Percy has stopped']);
  });

  it('logs when percy is disabled', async () => {
    process.env.PERCY_ENABLE = '0';
    await stop();

    expect(logger.stdout).toEqual([]);
    expect(logger.stderr).toEqual(['[percy] Percy is disabled']);
  });

  it('logs an error when the endpoint errors', async () => {
    await expectAsync(stop()).toBeRejected();

    expect(logger.stdout).toEqual([]);
    expect(logger.stderr).toEqual(['[percy] Percy is not running']);
  });
});
