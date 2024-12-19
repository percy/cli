import { logger, api, setupTest } from '@percy/cli-command/test/helpers';
import exec from '@percy/cli-exec';
describe('percy exec', () => {
  beforeEach(async () => {
    process.env.PERCY_TOKEN = '<<PERCY_TOKEN>>';
    process.env.PERCY_FORCE_PKG_VALUE = JSON.stringify({ "name": "@percy/client", "version": "1.0.0" });
    jasmine.DEFAULT_TIMEOUT_INTERVAL = 25000;
    await setupTest();

    let { default: which } = await import('which');
    spyOn(which, 'sync').and.callFake(c => c);
    spyOn(process, 'exit').and.callFake(c => c);
    process.env.PERCY_CLIENT_ERROR_LOGS = false;

    // Ensure global.__MOCK_IMPORTS__ is defined
    global.__MOCK_IMPORTS__ = global.__MOCK_IMPORTS__ || new Map();
  });

  afterEach(() => {
    delete process.env.PERCY_TOKEN;
    delete process.env.PERCY_FORCE_PKG_VALUE;
    delete process.env.PERCY_ENABLE;
    delete process.env.PERCY_BUILD_ID;
    delete process.env.PERCY_PARALLEL_TOTAL;
    delete process.env.PERCY_PARTIAL_BUILD;
    delete process.env.PERCY_CLIENT_ERROR_LOGS;
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

    expect(logger.stderr).toEqual(jasmine.arrayContaining([
      '[percy] Detected error for percy build',
      '[percy] Failure: Snapshot command was not called',
      '[percy] Failure Reason: Snapshot Command was not called. please check your CI for errors',
      '[percy] Suggestion: Try using percy snapshot command to take snapshots',
      '[percy] Refer to the below Doc Links for the same',
      '[percy] * https://www.browserstack.com/docs/percy/take-percy-snapshots/'
    ]));

    expect(logger.stdout).toEqual([
      '[percy] Percy has started!',
      '[percy] Running "node --eval "',
      '[percy] Finalized build #1: https://percy.io/test/test/123',
      "[percy] Build's CLI logs sent successfully. Please share this log ID with Percy team in case of any issues - random_sha",
      '[percy] Command "node --eval " exited with status: 0'
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
      '[percy] Running "node --eval "',
      '[percy] Command "node --eval " exited with status: 0'
    ]);
  });

  it('runs the command even when PERCY_TOKEN is missing', async () => {
    delete process.env.PERCY_TOKEN;
    delete process.env.PERCY_FORCE_PKG_VALUE;
    await exec(['--', 'node', '--eval', '']);

    expect(logger.stderr).toEqual(jasmine.arrayContaining([
      '[percy] Skipping visual tests',
      '[percy] Error: Missing Percy token'
    ]));
    expect(logger.stdout).toEqual(jasmine.arrayContaining([
      '[percy] Running "node --eval "'
    ]));
  });

  it('forwards the command status', async () => {
    await expectAsync(
      exec(['--', 'node', '--eval', 'process.exit(3)'])
    ).toBeRejectedWithError('EEXIT: 3');

    expect(logger.stderr).toEqual(jasmine.arrayContaining([
      '[percy] Detected error for percy build',
      '[percy] Failure: Snapshot command was not called',
      '[percy] Failure Reason: Snapshot Command was not called. please check your CI for errors',
      '[percy] Suggestion: Try using percy snapshot command to take snapshots',
      '[percy] Refer to the below Doc Links for the same',
      '[percy] * https://www.browserstack.com/docs/percy/take-percy-snapshots/'
    ]));
    expect(logger.stdout).toEqual(jasmine.arrayContaining([
      '[percy] Percy has started!',
      '[percy] Running "node --eval process.exit(3)"',
      '[percy] Finalized build #1: https://percy.io/test/test/123'
    ]));
  });

  it('tests process.stdout', async () => {
    let stdoutSpy = spyOn(process.stdout, 'write').and.resolveTo('some response');
    await exec(['--', 'echo', 'Hi!']);

    expect(stdoutSpy).toHaveBeenCalled();
    expect(logger.stderr).toEqual(jasmine.arrayContaining([
      '[percy] Detected error for percy build',
      '[percy] Failure: Snapshot command was not called',
      '[percy] Failure Reason: Snapshot Command was not called. please check your CI for errors',
      '[percy] Suggestion: Try using percy snapshot command to take snapshots',
      '[percy] Refer to the below Doc Links for the same',
      '[percy] * https://www.browserstack.com/docs/percy/take-percy-snapshots/'
    ]));
    expect(logger.stdout).toEqual(jasmine.arrayContaining([
      '[percy] Percy has started!',
      '[percy] Running "echo Hi!"',
      '[percy] Finalized build #1: https://percy.io/test/test/123'
    ]));
  });

  it('adds process.stderr logs in CI logs', async () => {
    process.env.PERCY_CLIENT_ERROR_LOGS = true;
    let stderrSpy = spyOn(process.stderr, 'write').and.resolveTo(jasmine.stringMatching(/Some error/));
    await expectAsync(
      exec(['--', 'node', './test/test-data/test_prog.js', 'error']) // Throws Error
    ).toBeRejectedWithError('EEXIT: 1');

    expect(logger.stderr).toEqual(jasmine.arrayContaining([
      '[percy] Detected error for percy build',
      '[percy] Failure: Snapshot command was not called',
      '[percy] Failure Reason: Snapshot Command was not called. please check your CI for errors',
      '[percy] Suggestion: Try using percy snapshot command to take snapshots',
      '[percy] Refer to the below Doc Links for the same',
      '[percy] * https://www.browserstack.com/docs/percy/take-percy-snapshots/',
      '[percy] Notice: Percy collects CI logs to improve service and enhance your experience. These logs help us debug issues and provide insights on your dashboards, making it easier to optimize the product experience. Logs are stored securely for 30 days. You can opt out anytime with export PERCY_CLIENT_ERROR_LOGS=false, but keeping this enabled helps us offer the best support and features.'
    ]));

    expect(logger.stdout).toEqual(jasmine.arrayContaining([
      '[percy] Percy has started!',
      '[percy] Running "node ./test/test-data/test_prog.js error"',
      '[percy] Finalized build #1: https://percy.io/test/test/123'
    ]));

    expect(logger.instance.query(log => log.debug === 'ci')[0].message).toContain([
      'Some error with secret: [REDACTED]'
    ]);
    expect(stderrSpy).toHaveBeenCalled();
  });

  it('does not adds process.stderr logs if percy is disabled', async () => {
    process.env.PERCY_ENABLE = '0';
    let stderrSpy = spyOn(process.stderr, 'write').and.resolveTo(jasmine.stringMatching(/Some error/));
    await expectAsync(
      exec(['--', 'node', './test/test-data/test_prog.js', 'error']) // Throws Error
    ).toBeRejectedWithError('EEXIT: 1');

    expect(logger.stderr).toEqual([
      '[percy] Percy is disabled'
    ]);
    expect(logger.stdout).toEqual(jasmine.arrayContaining([
      '[percy] Running "node ./test/test-data/test_prog.js error"'
    ]));

    expect(logger.instance.query(log => log.debug === 'ci')).toEqual([]);
    expect(stderrSpy).toHaveBeenCalled();
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

    let stdinSpy = spyOn(process.stdin, 'pipe').and.resolveTo('some response');

    await expectAsync(exec(['--', 'foobar'])).toBeRejected();

    expect(stdinSpy).toHaveBeenCalled();
    expect(logger.stderr).toEqual(jasmine.arrayContaining([
      '[percy] Detected error for percy build',
      '[percy] Failure: Snapshot command was not called',
      '[percy] Failure Reason: Snapshot Command was not called. please check your CI for errors',
      '[percy] Suggestion: Try using percy snapshot command to take snapshots',
      '[percy] Refer to the below Doc Links for the same',
      '[percy] * https://www.browserstack.com/docs/percy/take-percy-snapshots/'
    ]));
    expect(logger.stdout).toEqual(jasmine.arrayContaining([
      '[percy] Percy has started!',
      '[percy] Running "foobar"',
      '[percy] Stopping percy...',
      '[percy] Finalized build #1: https://percy.io/test/test/123'
    ]));
  });

  it('handles terminating the child process when interrupted', async () => {
    // exits non-zero on completion
    let test = exec(['--', 'node', '--eval', (
      'setTimeout(() => process.exit(1), 5000)'
    )]);

    // wait until the process starts
    await new Promise(r => setTimeout(r, 1000));
    expect(logger.stdout).toEqual(jasmine.arrayContaining([
      jasmine.stringContaining('[percy] Running "node --eval ')
    ]));

    // signal events are handled while running
    process.emit('SIGTERM');
    // user termination is not considered an error
    await expectAsync(test).toBeResolved();

    expect(logger.stderr).toEqual(jasmine.arrayContaining([
      '[percy] Detected error for percy build',
      '[percy] Failure: Snapshot command was not called',
      '[percy] Failure Reason: Snapshot Command was not called. please check your CI for errors',
      '[percy] Suggestion: Try using percy snapshot command to take snapshots',
      '[percy] Refer to the below Doc Links for the same',
      '[percy] * https://www.browserstack.com/docs/percy/take-percy-snapshots/'
    ]));

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

    expect(logger.stderr).toEqual(jasmine.arrayContaining([
      '[percy] Detected error for percy build',
      '[percy] Failure: Snapshot command was not called',
      '[percy] Failure Reason: Snapshot Command was not called. please check your CI for errors',
      '[percy] Suggestion: Try using percy snapshot command to take snapshots',
      '[percy] Refer to the below Doc Links for the same',
      '[percy] * https://www.browserstack.com/docs/percy/take-percy-snapshots/'
    ]));

    expect(logger.stdout).toEqual(jasmine.arrayContaining([
      '[percy] Percy has started!',
      jasmine.stringMatching('\\[percy] Running "node '),
      '[percy] Finalized build #1: https://percy.io/test/test/123'
    ]));
  });

  it('provides the child process with a percy build id env var', async () => {
    await exec(['--', 'node', '--eval', (
      'process.env.PERCY_BUILD_ID === "123" || process.exit(2)'
    )]);

    expect(logger.stderr).toEqual(jasmine.arrayContaining([
      '[percy] Detected error for percy build',
      '[percy] Failure: Snapshot command was not called',
      '[percy] Failure Reason: Snapshot Command was not called. please check your CI for errors',
      '[percy] Suggestion: Try using percy snapshot command to take snapshots',
      '[percy] Refer to the below Doc Links for the same',
      '[percy] * https://www.browserstack.com/docs/percy/take-percy-snapshots/'
    ]));
    expect(logger.stdout).toEqual(jasmine.arrayContaining([
      '[percy] Percy has started!',
      jasmine.stringMatching('\\[percy] Running "node '),
      '[percy] Finalized build #1: https://percy.io/test/test/123'
    ]));
  });

  it('provides the child process with a percy build url env var', async () => {
    await exec(['--', 'node', '--eval', (
      'process.env.PERCY_BUILD_URL === "https://percy.io/test/test/123" || process.exit(2)'
    )]);

    expect(logger.stderr).toEqual(jasmine.arrayContaining([
      '[percy] Detected error for percy build',
      '[percy] Failure: Snapshot command was not called',
      '[percy] Failure Reason: Snapshot Command was not called. please check your CI for errors',
      '[percy] Suggestion: Try using percy snapshot command to take snapshots',
      '[percy] Refer to the below Doc Links for the same',
      '[percy] * https://www.browserstack.com/docs/percy/take-percy-snapshots/'
    ]));
    expect(logger.stdout).toEqual(jasmine.arrayContaining([
      '[percy] Percy has started!',
      jasmine.stringMatching('\\[percy] Running "node '),
      '[percy] Finalized build #1: https://percy.io/test/test/123'
    ]));
  });
});
