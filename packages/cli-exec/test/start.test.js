import expect from 'expect';
import fetch from 'node-fetch';
import { stdio } from './helpers';
import { Start } from '../src/commands/exec/start';
import { Stop } from '../src/commands/exec/stop';

describe('percy exec:start', () => {
  beforeEach(async () => {
    await Start.run(['--quiet']);
  });

  afterEach(async () => {
    await Stop.run(['--silent']).catch(() => {});
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
    // wait for event to be handled
    await new Promise(r => setTimeout(r, 100));

    await expect(
      fetch('http://localhost:5338/percy/healthcheck', { timeout: 10 })
    ).rejects.toThrow();
  });

  it('logs an error when percy is already running', async () => {
    await expect(stdio.capture(() => Start.run([])))
      .rejects.toThrow('EEXIT: 1');

    expect(stdio[1]).toHaveLength(0);
    expect(stdio[2]).toEqual([
      '[percy] Error: Percy is already running or the port is in use\n'
    ]);
  });

  it('logs when percy has been disabled', async () => {
    await Stop.run(['--quiet']);

    process.env.PERCY_ENABLE = '0';
    await stdio.capture(() => Start.run([]));

    expect(stdio[2]).toHaveLength(0);
    expect(stdio[1]).toEqual([
      '[percy] Percy has been disabled. Not starting\n'
    ]);
  });
});
