import { logger, api, setupTest } from '@percy/cli-command/test/helpers';
import exec from '@percy/cli-exec';

describe('percy exec', () => {
  beforeEach(async () => {
    process.env.PERCY_TOKEN = '<<PERCY_TOKEN>>';
    await setupTest();

    let { default: which } = await import('which');
    spyOn(which, 'sync').and.callFake(c => c);
  });

  afterEach(() => {
    delete process.env.PERCY_TOKEN;
    delete process.env.PERCY_ENABLE;
    delete process.env.PERCY_BUILD_ID;
    delete process.env.PERCY_PARALLEL_TOTAL;
    delete process.env.PERCY_PARTIAL_BUILD;
  });

  describe('projectType is app', () => {
    const type = exec.definition.percy.projectType;
    const logInfo = logger.loglevel();

    beforeEach(() => {
      exec.definition.percy.projectType = 'app';
      logger.loglevel('debug');
      process.env.PERCY_LOGLEVEL = 'debug';
    });

    afterEach(() => {
      exec.definition.percy.projectType = type;
      logger.loglevel(logInfo);
      logger.reset(true);
      delete process.env.PERCY_LOGLEVEL;
    });

    it('does not call override function', async () => {
      await exec(['--', 'node', '--eval', '']);
      expect(logger.stderr).toEqual(
        jasmine.arrayContaining([
          '[percy:cli] Skipping percy project attribute calculation'
        ])
      );
    });
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
    which.sync.and.returnValue(null);

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

  it('tests process.stdout', async () => {
    let stdoutSpy = spyOn(process.stdout, 'write').and.resolveTo('some response');
    await exec(['--', 'echo', 'Hi!']);

    expect(stdoutSpy).toHaveBeenCalled();
    expect(logger.stderr).toEqual([]);
    expect(logger.stdout).toEqual([
      '[percy] Percy has started!',
      '[percy] Running "echo Hi!"',
      '[percy] Finalized build #1: https://percy.io/test/test/123'
    ]);
  });

  it('tests process.stderr', async () => {
    let stderrSpy = spyOn(process.stderr, 'write').and.resolveTo('some response');
    await expectAsync(
      exec(['--', 'node', 'random.js']) // invalid command
    ).toBeRejectedWithError('EEXIT: 1');

    expect(stderrSpy).toHaveBeenCalled();
    expect(logger.stderr).toEqual([]);
    expect(logger.stdout).toEqual([
      '[percy] Percy has started!',
      '[percy] Running "node random.js"',
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
    let { default: EventEmitter } = await import('events');
    let [e, err] = [new EventEmitter(), new Error('spawn error')];
    let crossSpawn = () => (setImmediate(() => e.emit('error', err)), e);
    global.__MOCK_IMPORTS__.set('cross-spawn', { default: crossSpawn });

    await expectAsync(exec(['--', 'foobar'])).toBeRejected();

    expect(logger.stderr).toEqual([
      '[percy] Error: spawn error'
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
    let args = ['--no-warnings', '--input-type=module', '--loader=../../scripts/loader.js'];

    await exec(['--port=4567', '--', 'node', ...args, '--eval', [
      'import { request } from "../cli-command/src/utils.js";',
      'let url = new URL("/percy/healthcheck", process.env.PERCY_SERVER_ADDRESS);',
      'await request(url).catch(e => (console.error(e), process.exit(2)));'
    ].join('')]);

    expect(logger.stderr).toEqual([]);
    expect(logger.stdout).toEqual([
      '[percy] Percy has started!',
      jasmine.stringMatching('\\[percy] Running "node '),
      '[percy] Finalized build #1: https://percy.io/test/test/123'
    ]);
  });

  it('provides the child process with a percy build id env var', async () => {
    await exec(['--', 'node', '--eval', (
      'process.env.PERCY_BUILD_ID === "123" || process.exit(2)'
    )]);

    expect(logger.stderr).toEqual([]);
    expect(logger.stdout).toEqual([
      '[percy] Percy has started!',
      jasmine.stringMatching('\\[percy] Running "node '),
      '[percy] Finalized build #1: https://percy.io/test/test/123'
    ]);
  });

  it('provides the child process with a percy build url env var', async () => {
    await exec(['--', 'node', '--eval', (
      'process.env.PERCY_BUILD_URL === "https://percy.io/test/test/123" || process.exit(2)'
    )]);

    expect(logger.stderr).toEqual([]);
    expect(logger.stdout).toEqual([
      '[percy] Percy has started!',
      jasmine.stringMatching('\\[percy] Running "node '),
      '[percy] Finalized build #1: https://percy.io/test/test/123'
    ]);
  });
});
