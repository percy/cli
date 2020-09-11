import expect from 'expect';
import mock from 'mock-require';
import { stdio } from './helpers';
import { Exec } from '../src/commands/exec';

describe('percy exec', () => {
  it('logs an error when no command is provided', async () => {
    await expect(stdio.capture(() => (
      Exec.run([])
    ))).rejects.toThrow('EEXIT: 1');

    expect(stdio[2]).toEqual([
      '[percy] You must supply a command to run after --\n'
    ]);
    expect(stdio[1]).toEqual([
      '[percy] Example:\n',
      '[percy] $ percy exec -- echo "run your test suite"\n'
    ]);
  });

  it('logs an error when the command cannot be found', async () => {
    await expect(stdio.capture(() => (
      Exec.run(['--', 'foobar'])
    ))).rejects.toThrow('EEXIT: 127');

    expect(stdio[1]).toHaveLength(0);
    expect(stdio[2]).toEqual([
      '[percy] Error: command not found "foobar"\n'
    ]);
  });

  it('starts and stops the percy process around the command', async () => {
    await stdio.capture(() => (
      Exec.run(['--', 'sleep', '0.1'])
    ));

    expect(stdio[2]).toHaveLength(0);
    expect(stdio[1]).toEqual([
      '[percy] Percy has started!\n',
      '[percy] Created build #1: https://percy.io/test/test/123\n',
      '[percy] Running "sleep 0.1"\n',
      '[percy] Stopping percy...\n',
      '[percy] Finalized build #1: https://percy.io/test/test/123\n',
      '[percy] Done!\n'
    ]);
  });

  it('runs the command even when percy is disabled', async () => {
    process.env.PERCY_ENABLE = '0';

    await stdio.capture(() => (
      Exec.run(['--', 'sleep', '0.1'])
    ));

    expect(stdio[2]).toHaveLength(0);
    expect(stdio[1]).toHaveLength(0);
  });

  it('runs the command even when PERCY_TOKEN is missing', async () => {
    delete process.env.PERCY_TOKEN;

    await stdio.capture(() => (
      Exec.run(['--', 'sleep', '0.1'])
    ));

    expect(stdio[2]).toHaveLength(0);
    expect(stdio[1]).toEqual([
      '[percy] Skipping visual tests - Missing Percy token\n',
      '[percy] Running "sleep 0.1"\n'
    ]);
  });

  it('forwards the command status', async () => {
    await expect(stdio.capture(() => (
      Exec.run(['--', 'bash', '-c', 'exit 3'])
    ))).rejects.toThrow('EEXIT: 3');

    expect(stdio[2]).toHaveLength(0);
    expect(stdio[1]).toEqual([
      '[percy] Percy has started!\n',
      '[percy] Created build #1: https://percy.io/test/test/123\n',
      '[percy] Running "bash -c exit 3"\n',
      '[percy] Stopping percy...\n',
      '[percy] Finalized build #1: https://percy.io/test/test/123\n',
      '[percy] Done!\n'
    ]);
  });

  it('throws when the command receives an error event and stops percy', async () => {
    // skip our own ENOENT check to trigger a child process error event
    mock('which', { sync: () => true });
    let { Exec } = mock.reRequire('../src/commands/exec');

    await expect(stdio.capture(() => (
      Exec.run(['--', 'foobar'])
    ))).rejects.toThrow('EEXIT: 1');

    expect(stdio[2]).toEqual([
      '[percy] Error: spawn foobar ENOENT\n'
    ]);
    expect(stdio[1]).toEqual([
      '[percy] Percy has started!\n',
      '[percy] Created build #1: https://percy.io/test/test/123\n',
      '[percy] Running "foobar"\n',
      '[percy] Stopping percy...\n',
      '[percy] Finalized build #1: https://percy.io/test/test/123\n',
      '[percy] Done!\n'
    ]);
  });
});
