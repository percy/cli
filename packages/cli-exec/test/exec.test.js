import { logger, api, setupTest } from '@percy/cli-command/test/helpers';
import exec from '../src/exec';

describe('percy exec', () => {
  beforeEach(async () => {
    process.env.PERCY_TOKEN = '<<PERCY_TOKEN>>';
    await setupTest();

    delete require.cache[require.resolve('which')];
    let { default: which } = await import('which');
    spyOn(which, 'sync').and.returnValue(true);
  });

  afterEach(() => {
    delete process.env.PERCY_TOKEN;
    delete process.env.PERCY_ENABLE;
    delete process.env.PERCY_PARALLEL_TOTAL;
    delete process.env.PERCY_PARTIAL_BUILD;
  });

  it('logs an error when no command is provided', async () => {
    await expectAsync(exec()).toBeRejected();

    expect(logger.stderr).toEqual([
      "[percy] You must supply a command to run after '--'"
    ]);
    expect(logger.stdout).toEqual([
      '[percy] Example:',
      '[percy]   $ percy exec -- npm test'
    ]);
  });

  it('logs an error when the command cannot be found', async () => {
    let { default: which } = await import('which');
    which.sync.and.returnValue(false);

    await expectAsync(exec(['--', 'foobar'])).toBeRejected();

    expect(logger.stdout).toEqual([]);
    expect(logger.stderr).toEqual([
      '[percy] Error: Command not found "foobar"'
    ]);
  });

  it('starts and stops the percy process around the command', async () => {
    await exec(['--', 'node', '--eval', '']);

    expect(logger.stderr).toEqual([]);
    expect(logger.stdout).toEqual([
      '[percy] Percy has started!',
      '[percy] Running "node --eval "',
      '[percy] Finalized build #1: https://percy.io/test/test/123'
    ]);
  });

  it('sets the parallel total when the --parallel flag is provided', async () => {
    expect(process.env.PERCY_PARALLEL_TOTAL).toBeUndefined();
    await exec(['--parallel', '--', 'node', '--eval', '']);
    expect(process.env.PERCY_PARALLEL_TOTAL).toBe('-1');
  });

  it('sets the partial env var when the --partial flag is provided', async () => {
    expect(process.env.PERCY_PARTIAL_BUILD).toBeUndefined();
    await exec(['--partial', '--', 'node', '--eval', '']);
    expect(process.env.PERCY_PARTIAL_BUILD).toBe('1');
  });

  it('runs the command even when percy is disabled', async () => {
    process.env.PERCY_ENABLE = '0';
    await exec(['--', 'node', '--eval', '']);

    expect(logger.stderr).toEqual([
      '[percy] Percy is disabled'
    ]);
    expect(logger.stdout).toEqual([
      '[percy] Running "node --eval "'
    ]);
  });

  it('runs the command even when PERCY_TOKEN is missing', async () => {
    delete process.env.PERCY_TOKEN;
    await exec(['--', 'node', '--eval', '']);

    expect(logger.stderr).toEqual([
      '[percy] Skipping visual tests',
      '[percy] Error: Missing Percy token'
    ]);
    expect(logger.stdout).toEqual([
      '[percy] Running "node --eval "'
    ]);
  });

  it('forwards the command status', async () => {
    await expectAsync(
      exec(['--', 'node', '--eval', 'process.exit(3)'])
    ).toBeRejectedWithError('EEXIT: 3');

    expect(logger.stderr).toEqual([]);
    expect(logger.stdout).toEqual([
      '[percy] Percy has started!',
      '[percy] Running "node --eval process.exit(3)"',
      '[percy] Finalized build #1: https://percy.io/test/test/123'
    ]);
  });

  it('does not run the command if canceled beforehand', async () => {
    // delay build creation to give time to cancel
    api.reply('/builds', () => new Promise(resolve => {
      setTimeout(resolve, 1000, [201, { data: { attributes: {} } }]);
    }));

    // run and wait for the above request to begin
    let test = exec(['--', 'node', '--eval', '']);
    await new Promise(r => setTimeout(r, 500));

    // signal events are handled while running
    process.emit('SIGTERM');
    // user termination is not considered an error
    await expectAsync(test).toBeResolved();

    expect(logger.stderr).toEqual([]);
    expect(logger.stdout).not.toContain(
      '[percy] Running "node --eval "');
  });

  it('throws when the command receives an error event and stops percy', async () => {
    await expectAsync(exec(['--', 'foobar'])).toBeRejected();

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

  it('handles terminating the child process when interrupted', async () => {
    // exits non-zero on completion
    let test = exec(['--', 'node', '--eval', (
      'setTimeout(() => process.exit(1), 5000)'
    )]);

    // wait until the process starts
    await new Promise(r => setTimeout(r, 500));
    expect(logger.stdout).toEqual(jasmine.arrayContaining([
      jasmine.stringContaining('[percy] Running "node --eval ')
    ]));

    // signal events are handled while running
    process.emit('SIGTERM');
    // user termination is not considered an error
    await expectAsync(test).toBeResolved();

    expect(logger.stderr).toEqual([]);
    expect(logger.stdout).toContain(
      '[percy] Stopping percy...'
    );
  });

  it('provides the child process with a percy server address env var', async () => {
    await exec(['--port=1234', '--', 'node', '--eval', [
      'require("@percy/cli-command/utils")',
      '.request(new URL("/percy/healthcheck", process.env.PERCY_SERVER_ADDRESS))',
      '.catch(e => (console.error(e), process.exit(1)))'
    ].join('')]);

    expect(logger.stderr).toEqual([]);
    expect(logger.stdout).toEqual([
      '[percy] Percy has started!',
      jasmine.stringMatching('\\[percy] Running "node --eval '),
      '[percy] Finalized build #1: https://percy.io/test/test/123'
    ]);
  });
});
