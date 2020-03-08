import expect from 'expect';
import nock from 'nock';
import { stdio } from './helpers';
import { Stop } from '../src/commands/exec/stop';

describe('percy exec:stop', () => {
  it('calls the /percy/stop endpoint and logs', async () => {
    let request = nock('http://localhost:5338')
      .post('/percy/stop').reply(200, { success: true });

    await stdio.capture(() => Stop.run([]));

    expect(stdio[2]).toHaveLength(0);
    expect(stdio[1]).toEqual(['[percy] Percy has stopped\n']);
    request.done();
  });

  it('logs when percy is disabled', async () => {
    process.env.PERCY_ENABLE = '0';
    await stdio.capture(() => Stop.run([]));

    expect(stdio[2]).toHaveLength(0);
    expect(stdio[1]).toEqual(['[percy] Percy is disabled\n']);
  });

  it('logs an error when the endpoint errors', async () => {
    nock('http://localhost:5338').post('/percy/stop').reply(500);

    await expect(stdio.capture(() => (
      Stop.run([])
    ))).rejects.toThrow('EEXIT: 1');

    expect(stdio[1]).toHaveLength(0);
    expect(stdio[2]).toEqual(['[percy] Percy is not running\n']);
  });
});
