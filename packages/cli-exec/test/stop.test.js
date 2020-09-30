import expect from 'expect';
import { stdio, createTestServer } from './helpers';
import { Stop } from '../src/commands/exec/stop';

describe('percy exec:stop', () => {
  let percyServer;

  afterEach(async () => {
    await percyServer?.close();
  });

  it('calls the /percy/stop endpoint and logs when the server is down', async () => {
    percyServer = await createTestServer({
      '/percy/stop': () => [200, 'application/json', { success: true }]
    }, 5338);

    await stdio.capture(() => Stop.run([]));

    expect(percyServer.requests).toEqual([
      ['/percy/stop'],
      ['/percy/healthcheck']
    ]);

    expect(stdio[2]).toHaveLength(0);
    expect(stdio[1]).toEqual(['[percy] Percy has stopped\n']);
  });

  it('logs when percy is disabled', async () => {
    process.env.PERCY_ENABLE = '0';
    await stdio.capture(() => Stop.run([]));

    expect(stdio[2]).toHaveLength(0);
    expect(stdio[1]).toEqual(['[percy] Percy is disabled\n']);
  });

  it('logs an error when the endpoint errors', async () => {
    await expect(stdio.capture(() => Stop.run([])))
      .rejects.toThrow('EEXIT: 1');

    expect(stdio[1]).toHaveLength(0);
    expect(stdio[2]).toEqual(['[percy] Percy is not running\n']);
  });
});
