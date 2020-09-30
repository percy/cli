import expect from 'expect';
import { stdio, createTestServer } from './helpers';
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

    await stdio.capture(() => Ping.run([]));

    expect(percyServer.requests).toEqual([['/percy/healthcheck']]);

    expect(stdio[2]).toHaveLength(0);
    expect(stdio[1]).toEqual(['[percy] Percy is running\n']);
  });

  it('logs an error when the endpoint errors', async () => {
    await expect(stdio.capture(() => Ping.run([])))
      .rejects.toThrow('EEXIT: 1');

    expect(stdio[1]).toHaveLength(0);
    expect(stdio[2]).toEqual(['[percy] Percy is not running\n']);
  });
});
