import logger from '@percy/logger/test/helpers';
import mockAPI from '@percy/client/test/helpers';
import { Wait } from '../src/commands/build/wait';

describe('percy build:wait', () => {
  let build = attrs => ({
    data: {
      attributes: {
        'build-number': 10,
        'web-url': 'https://percy.io/test/test/123',
        'total-snapshots': 18,
        'total-comparisons': 72,
        'total-comparisons-finished': 0,
        state: 'processing',
        ...attrs
      }
    }
  });

  beforeEach(() => {
    process.env.PERCY_TOKEN = '<<PERCY_TOKEN>>';
    mockAPI.start();
    logger.mock({ isTTY: true });
  });

  afterEach(() => {
    delete process.env.PERCY_TOKEN;
    delete process.env.PERCY_ENABLE;
    process.removeAllListeners();
  });

  it('does nothing and logs when percy is not enabled', async () => {
    process.env.PERCY_ENABLE = '0';
    await Wait.run([]);

    expect(logger.stderr).toEqual([]);
    expect(logger.stdout).toEqual([
      '[percy] Percy is disabled'
    ]);
  });

  it('logs an error and exits when required args are missing', async () => {
    await expectAsync(Wait.run([])).toBeRejectedWithError('EEXIT: 1');
    expect(logger.stdout).toEqual([]);
    expect(logger.stderr).toEqual([
      '[percy] Error: Missing build ID or commit SHA'
    ]);
  });

  it('logs while recieving snapshots', async () => {
    mockAPI
      .reply('/builds/123', () => [200, build({
        state: 'pending'
      })])
      .reply('/builds/123', () => [200, build({
        'total-comparisons-finished': 72,
        state: 'finished'
      })]);

    await Wait.run(['--build=123', '--interval=50']);

    expect(logger.stderr).toEqual([]);
    expect(logger.stdout).toEqual(jasmine.arrayContaining([
      '[percy] Recieving snapshots...'
    ]));
  });

  it('logs while processing snapshots', async () => {
    mockAPI
      .reply('/builds/123', () => [200, build({
        'total-comparisons-finished': 16
      })])
      .reply('/builds/123', () => [200, build({
        'total-comparisons-finished': 32
      })])
      .reply('/builds/123', () => [200, build({
        'total-comparisons-finished': 72
      })])
      .reply('/builds/123', () => [200, build({
        state: 'finished'
      })]);

    await Wait.run(['--build=123', '--interval=50']);

    expect(logger.stderr).toEqual([]);
    expect(logger.stdout).toEqual(jasmine.arrayContaining([
      '[percy] Processing 18 snapshots - 16 of 72 comparisons finished...',
      '[percy] Processing 18 snapshots - 32 of 72 comparisons finished...',
      '[percy] Processing 18 snapshots - finishing up...'
    ]));
  });

  it('logs found diffs when finished', async () => {
    mockAPI.reply('/builds/123', () => [200, build({
      'total-comparisons-diff': 16,
      state: 'finished'
    })]);

    await Wait.run(['--build=123']);

    expect(logger.stderr).toEqual([]);
    expect(logger.stdout).toEqual(jasmine.arrayContaining([
      '[percy] Build #10 finished! https://percy.io/test/test/123',
      '[percy] Found 16 changes'
    ]));
  });

  it('exits and logs found diffs when finished', async () => {
    mockAPI.reply('/builds/123', () => [200, build({
      'total-comparisons-diff': 16,
      state: 'finished'
    })]);

    await expectAsync(Wait.run(['--build=123', '-f'])).toBeRejectedWithError('EEXIT: 1');

    expect(logger.stderr).toEqual([]);
    expect(logger.stdout).toEqual(jasmine.arrayContaining([
      '[percy] Build #10 finished! https://percy.io/test/test/123',
      '[percy] Found 16 changes'
    ]));
  });

  it('does not exit when diffs are not found', async () => {
    mockAPI.reply('/builds/123', () => [200, build({
      'total-comparisons-diff': 0,
      state: 'finished'
    })]);

    await Wait.run(['--build=123', '-f']);

    expect(logger.stderr).toEqual([]);
    expect(logger.stdout).toEqual(jasmine.arrayContaining([
      '[percy] Build #10 finished! https://percy.io/test/test/123',
      '[percy] Found 0 changes'
    ]));
  });

  it('exits and logs the build state when unrecognized', async () => {
    mockAPI.reply('/builds/123', () => [200, build({ state: 'expired' })]);
    await expectAsync(Wait.run(['--build=123'])).toBeRejectedWithError('EEXIT: 1');

    expect(logger.stdout).toEqual([]);
    expect(logger.stderr).toEqual(jasmine.arrayContaining([
      '[percy] Build #10 is expired. https://percy.io/test/test/123'
    ]));
  });

  describe('failure messages', () => {
    it('logs an error and exits when there are no snapshots', async () => {
      mockAPI.reply('/builds/123', () => [200, build({
        state: 'failed',
        'failure-reason': 'render_timeout'
      })]);

      await expectAsync(Wait.run(['--build=123'])).toBeRejectedWithError('EEXIT: 1');

      expect(logger.stdout).toEqual([]);
      expect(logger.stderr).toEqual(jasmine.arrayContaining([
        '[percy] Build #10 failed! https://percy.io/test/test/123',
        '[percy] Some snapshots in this build took too long to render ' +
          'even after multiple retries.'
      ]));
    });

    it('logs an error and exits when there are no snapshots', async () => {
      mockAPI.reply('/builds/123', () => [200, build({
        state: 'failed',
        'failure-reason': 'no_snapshots'
      })]);

      await expectAsync(Wait.run(['--build=123'])).toBeRejectedWithError('EEXIT: 1');

      expect(logger.stdout).toEqual([]);
      expect(logger.stderr).toEqual(jasmine.arrayContaining([
        '[percy] Build #10 failed! https://percy.io/test/test/123',
        '[percy] No snapshots were uploaded to this build.'
      ]));
    });

    it('logs an error and exits when the build was not finalized', async () => {
      mockAPI.reply('/builds/123', () => [200, build({
        state: 'failed',
        'failure-reason': 'missing_finalize'
      })]);

      await expectAsync(Wait.run(['--build=123'])).toBeRejectedWithError('EEXIT: 1');

      expect(logger.stdout).toEqual([]);
      expect(logger.stderr).toEqual(jasmine.arrayContaining([
        '[percy] Build #10 failed! https://percy.io/test/test/123',
        '[percy] Failed to correctly finalize.'
      ]));
    });

    it('logs an error and exits when build is missing resources', async () => {
      mockAPI.reply('/builds/123', () => [200, build({
        state: 'failed',
        'failure-reason': 'missing_resources'
      })]);

      await expectAsync(Wait.run(['--build=123'])).toBeRejectedWithError('EEXIT: 1');

      expect(logger.stdout).toEqual([]);
      expect(logger.stderr).toEqual(jasmine.arrayContaining([
        '[percy] Build #10 failed! https://percy.io/test/test/123',
        '[percy] Some build or snapshot resources failed to correctly upload.'
      ]));
    });

    it('logs an error and exits when parallel builds are missing', async () => {
      mockAPI.reply('/builds/123', () => [200, build({
        state: 'failed',
        'failure-reason': 'missing_resources',
        'failure-details': {
          missing_parallel_builds: true,
          parallel_builds_received: 3,
          parallel_builds_expected: 4
        }
      })]);

      await expectAsync(Wait.run(['--build=123'])).toBeRejectedWithError('EEXIT: 1');

      expect(logger.stdout).toEqual([]);
      expect(logger.stderr).toEqual(jasmine.arrayContaining([
        '[percy] Build #10 failed! https://percy.io/test/test/123',
        '[percy] Only 3 of 4 parallelized build processes finished.'
      ]));
    });

    it('logs the failure reason and exits when the reason is unrecognized', async () => {
      mockAPI.reply('/builds/123', () => [200, build({
        state: 'failed',
        'failure-reason': 'unrecognized_reason'
      })]);

      await expectAsync(Wait.run(['--build=123'])).toBeRejectedWithError('EEXIT: 1');

      expect(logger.stdout).toEqual([]);
      expect(logger.stderr).toEqual(jasmine.arrayContaining([
        '[percy] Build #10 failed! https://percy.io/test/test/123',
        '[percy] Error: unrecognized_reason'
      ]));
    });
  });
});
