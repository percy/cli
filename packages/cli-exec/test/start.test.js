import expect from 'expect';
import fetch from 'node-fetch';
import { logger } from './helpers';
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
    await new Promise(r => setTimeout(r, 500));

    await expect(
      fetch('http://localhost:5338/percy/healthcheck', { timeout: 10 })
    ).rejects.toThrow();
  });

  it('logs an error when percy is already running', async () => {
    await expect(Start.run([]))
      .rejects.toThrow('EEXIT: 1');

    expect(logger.stdout).toEqual([]);
    expect(logger.stderr).toEqual([
      '[percy] Error: Percy is already running or the port is in use\n'
    ]);
  });

  it('logs when percy has been disabled', async () => {
    await Stop.run(['--quiet']);

    process.env.PERCY_ENABLE = '0';
    await Start.run([]);

    expect(logger.stderr).toEqual([]);
    expect(logger.stdout).toEqual([
      '[percy] Percy has been disabled. Not starting\n'
    ]);
  });
});
