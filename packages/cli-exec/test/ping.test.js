import { logger, createTestServer } from './helpers';
import { Ping } from '../src/commands/exec/ping';

describe('percy exec:ping', () => {
  let percyServer;

  afterEach(async () => {
    await percyServer?.close();
  });

  it('calls the /percy/healthcheck endpoint and logs', async () => {
    percyServer = await createTestServer({
      '/percy/healthcheck': () => [200, 'application/json', { success: true }]
    }, 5338);

    await Ping.run([]);

    expect(percyServer.requests).toEqual([['/percy/healthcheck']]);

    expect(logger.stderr).toEqual([]);
    expect(logger.stdout).toEqual(['[percy] Percy is running\n']);
  });

  it('logs an error when the endpoint errors', async () => {
    await expectAsync(Ping.run([])).toBeRejectedWithError('EEXIT: 1');

    expect(logger.stdout).toEqual([]);
    expect(logger.stderr).toEqual(['[percy] Percy is not running\n']);
  });
});
