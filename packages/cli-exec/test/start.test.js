import expect from 'expect';
import fetch from 'node-fetch';
import { stdio } from './helpers';
import { Start } from '../src/commands/exec/start';

describe('percy exec:start', () => {
  async function stop() {
    await stdio.capture(() => (
      fetch('http://localhost:5338/percy/stop', {
        method: 'POST',
        timeout: 100
      }).catch(() => {})
    ));
  }

  beforeEach(async () => {
    await Start.run(['--quiet']);
  });

  afterEach(async () => {
    await stop();
  });

  it('starts a long-running percy process', async () => {
    let response = await fetch('http://localhost:5338/percy/healthcheck');
    await expect(response.json()).resolves.toHaveProperty('success', true);
  });

  it('stops the process when terminated', async () => {
    await expect(
      fetch('http://localhost:5338/percy/healthcheck')
    ).resolves.toBeDefined();

    process.emit('SIGTERM');

    await expect(
      fetch('http://localhost:5338/percy/healthcheck', { timeout: 10 })
    ).rejects.toThrow();
  });

  it('logs an error when percy is already running', async () => {
    await expect(stdio.capture(() => (
      Start.run([])
    ))).rejects.toThrow('EEXIT: 1');

    expect(stdio[1]).toHaveLength(0);
    expect(stdio[2]).toEqual([
      '[percy] Error: Percy is already running or the port is in use\n'
    ]);
  });

  it('logs when percy has been disabled', async () => {
    await stop();

    process.env.PERCY_ENABLE = '0';
    await stdio.capture(() => Start.run([]));

    expect(stdio[2]).toHaveLength(0);
    expect(stdio[1]).toEqual([
      '[percy] Percy has been disabled. Not starting\n'
    ]);
  });
});
