import { logger, createTestServer } from './helpers';
import { Stop } from '../src/commands/exec/stop';

describe('percy exec:stop', () => {
  let percyServer;

  afterEach(async () => {
    await percyServer?.close();
  });

  it('calls the /percy/stop endpoint and logs after the server goes down', async () => {
    percyServer = await createTestServer({
      '/percy/stop': () => [200, 'application/json', { success: true }]
    }, 5338);

    await Stop.run([]);

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

    await Stop.run([]);
    expect(check).toEqual(2);
  });

  it('logs when percy is disabled', async () => {
    process.env.PERCY_ENABLE = '0';
    await Stop.run([]);

    expect(logger.stderr).toEqual([]);
    expect(logger.stdout).toEqual(['[percy] Percy is disabled']);
  });

  it('logs an error when the endpoint errors', async () => {
    await expectAsync(Stop.run([])).toBeRejectedWithError('EEXIT: 1');

    expect(logger.stdout).toEqual([]);
    expect(logger.stderr).toEqual(['[percy] Percy is not running']);
  });
});
