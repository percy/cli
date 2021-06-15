import mock from 'mock-require';
import { logger } from './helpers';
import { Exec } from '../src/commands/exec';

describe('percy exec', () => {
  afterEach(() => {
    mock.stopAll();
  });

  it('logs an error when no command is provided', async () => {
    await expectAsync(Exec.run([])).toBeRejectedWithError('EEXIT: 1');

    expect(logger.stderr).toEqual([
      '[percy] You must supply a command to run after --'
    ]);
    expect(logger.stdout).toEqual([
      '[percy] Example:',
      '[percy] $ percy exec -- echo "run your test suite"'
    ]);
  });

  it('logs an error when the command cannot be found', async () => {
    await expectAsync(Exec.run(['--', 'foobar'])).toBeRejectedWithError('EEXIT: 127');

    expect(logger.stdout).toEqual([]);
    expect(logger.stderr).toEqual([
      '[percy] Error: command not found "foobar"'
    ]);
  });

  it('starts and stops the percy process around the command', async () => {
    await Exec.run(['--', 'node', '--eval', '']);

    expect(logger.stderr).toEqual([]);
    expect(logger.stdout).toEqual([
      '[percy] Percy has started!',
      '[percy] Running "node --eval "',
      '[percy] Finalized build #1: https://percy.io/test/test/123'
    ]);
  });

  it('sets the parallel total when the --parallel flag is provided', async () => {
    expect(process.env.PERCY_PARALLEL_TOTAL).toBeUndefined();
    await Exec.run(['--parallel', '--', 'node', '--eval', '']);
    expect(process.env.PERCY_PARALLEL_TOTAL).toBe('-1');
  });

  it('sets the partial env var when the --partial flag is provided', async () => {
    expect(process.env.PERCY_PARTIAL_BUILD).toBeUndefined();
    await Exec.run(['--partial', '--', 'node', '--eval', '']);
    expect(process.env.PERCY_PARTIAL_BUILD).toBe('1');
  });

  it('runs the command even when percy is disabled', async () => {
    process.env.PERCY_ENABLE = '0';
    await Exec.run(['--', 'node', '--eval', '']);

    expect(logger.stderr).toEqual([]);
    expect(logger.stdout).toEqual([]);
  });

  it('runs the command even when PERCY_TOKEN is missing', async () => {
    delete process.env.PERCY_TOKEN;
    await Exec.run(['--', 'node', '--eval', '']);

    expect(logger.stderr).toEqual([]);
    expect(logger.stdout).toEqual([
      '[percy] Skipping visual tests - Missing Percy token',
      '[percy] Running "node --eval "'
    ]);
  });

  it('forwards the command status', async () => {
    await expectAsync(Exec.run(['--', 'node', '--eval', 'process.exit(3)'])).toBeRejectedWithError('EEXIT: 3');

    expect(logger.stderr).toEqual([]);
    expect(logger.stdout).toEqual([
      '[percy] Percy has started!',
      '[percy] Running "node --eval process.exit(3)"',
      '[percy] Stopping percy...',
      '[percy] Finalized build #1: https://percy.io/test/test/123'
    ]);
  });

  it('throws when the command receives an error event and stops percy', async () => {
    // skip our own ENOENT check to trigger a child process error event
    mock('which', { sync: () => true });
    let { Exec } = mock.reRequire('../src/commands/exec');

    await expectAsync(Exec.run(['--', 'foobar'])).toBeRejectedWithError('EEXIT: 1');

    expect(logger.stderr).toEqual([
      '[percy] Error: spawn foobar ENOENT'
    ]);
    expect(logger.stdout).toEqual([
      '[percy] Percy has started!',
      '[percy] Running "foobar"',
      '[percy] Stopping percy...',
      '[percy] Finalized build #1: https://percy.io/test/test/123'
    ]);
  });
});
