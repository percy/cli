import { logger, createTestServer } from './helpers';
import stop from '../src/stop';

describe('percy exec:stop', () => {
  let percyServer;

  afterEach(async () => {
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
    }, 1234);

    await stop(['--port=1234']);

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
