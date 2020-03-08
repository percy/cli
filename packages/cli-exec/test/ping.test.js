import expect from 'expect';
import nock from 'nock';
import { stdio } from './helpers';
import { Ping } from '../src/commands/exec/ping';

describe('percy exec:ping', () => {
  it('calls the /percy/healthcheck endpoint and logs', async () => {
    let request = nock('http://localhost:5338')
      .get('/percy/healthcheck').reply(200, { success: true });

    await stdio.capture(() => Ping.run([]));

    expect(stdio[2]).toHaveLength(0);
    expect(stdio[1]).toEqual(['[percy] Percy is running\n']);
    request.done();
  });

  it('logs an error when the endpoint errors', async () => {
    nock('http://localhost:5338').post('/percy/healthcheck').reply(500);

    await expect(stdio.capture(() => (
      Ping.run([])
    ))).rejects.toThrow('EEXIT: 1');

    expect(stdio[1]).toHaveLength(0);
    expect(stdio[2]).toEqual(['[percy] Percy is not running\n']);
  });
});
