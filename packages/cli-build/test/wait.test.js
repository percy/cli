import { logger, api, setupTest } from '@percy/cli-command/test/helpers';
import { wait } from '@percy/cli-build';

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

  beforeEach(async () => {
    process.env.PERCY_TOKEN = '<<PERCY_TOKEN>>';
    await setupTest({ loggerTTY: true });
  });

  afterEach(() => {
    delete process.env.PERCY_TOKEN;
    delete process.env.PERCY_ENABLE;
  });

  it('does nothing and logs when percy is not enabled', async () => {
    process.env.PERCY_ENABLE = '0';
    await wait();

    expect(logger.stdout).toEqual([]);
    expect(logger.stderr).toEqual([
      '[percy] Percy is disabled'
    ]);
  });

  it('logs an error when required args are missing', async () => {
    await expectAsync(wait()).toBeRejected();

    expect(logger.stdout).toEqual([]);
    expect(logger.stderr).toEqual([
      '[percy] Error: Missing project path or build ID'
    ]);
  });

  it('logs while waiting for a matching build', async () => {
    api
      .reply('/projects/foo/bar/builds?filter[sha]=sha123', () => [200, { data: [] }])
      .reply('/projects/foo/bar/builds?filter[sha]=sha123', () => [200, {
        data: [build({ 'total-comparisons-finished': 72, state: 'finished' }).data]
      }]);

    await wait(['--project=foo/bar', '--commit=sha123', '--timeout=500', '--interval=50']);

    expect(logger.stderr).toEqual(['[percy] Ignoring interval since it cannot be less than 1000ms.']);
    expect(logger.stdout).toEqual(jasmine.arrayContaining([
      '[percy] Waiting for build...'
    ]));
  });

  it('logs while recieving snapshots', async () => {
    api
      .reply('/builds/123', () => [200, build({
        state: 'pending'
      })])
      .reply('/builds/123', () => [200, build({
        'total-comparisons-finished': 72,
        state: 'finished'
      })]);

    await wait(['--build=123', '--interval=50']);

    expect(logger.stderr).toEqual(['[percy] Ignoring interval since it cannot be less than 1000ms.']);
    expect(logger.stdout).toEqual(jasmine.arrayContaining([
      '[percy] Recieving snapshots...'
    ]));
  });

  it('logs while processing snapshots', async () => {
    api
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

    await wait(['--build=123', '--interval=50']);

    expect(logger.stderr).toEqual(['[percy] Ignoring interval since it cannot be less than 1000ms.']);
    expect(logger.stdout).toEqual(jasmine.arrayContaining([
      '[percy] Processing 18 snapshots - 16 of 72 comparisons finished...',
      '[percy] Processing 18 snapshots - 32 of 72 comparisons finished...',
      '[percy] Processing 18 snapshots - finishing up...'
    ]));
  });

  it('logs found diffs when finished', async () => {
    api.reply('/builds/123', () => [200, build({
      'total-comparisons-diff': 16,
      state: 'finished'
    })]);

    await wait(['--build=123']);

    expect(logger.stderr).toEqual([]);
    expect(logger.stdout).toEqual(jasmine.arrayContaining([
      '[percy] Build #10 finished! https://percy.io/test/test/123',
      '[percy] Found 16 changes'
    ]));
  });

  it('errors and logs found diffs when finished', async () => {
    api.reply('/builds/123', () => [200, build({
      'total-comparisons-diff': 16,
      state: 'finished'
    })]);

    await expectAsync(wait(['--build=123', '-f'])).toBeRejected();

    expect(logger.stderr).toEqual([]);
    expect(logger.stdout).toEqual(jasmine.arrayContaining([
      '[percy] Build #10 finished! https://percy.io/test/test/123',
      '[percy] Found 16 changes'
    ]));
  });

  it('errors on diffs if the pass-if-approved is on but diffs are unreviewed', async () => {
    api.reply('/builds/123', () => [200, build({
      'total-comparisons-diff': 16,
      'review-state': 'unreviewed',
      state: 'finished'
    })]);

    await expectAsync(wait(['--build=123', '-f', '--pass-if-approved'])).toBeRejected();

    expect(logger.stderr).toEqual([]);
    expect(logger.stdout).toEqual([
      '[percy] Build #10 finished! https://percy.io/test/test/123',
      '[percy] Found 16 changes'
    ]);
  });

  it('errors on diffs if the pass-if-approved is on but diffs have changes requested', async () => {
    api.reply('/builds/123', () => [200, build({
      'total-comparisons-diff': 16,
      'review-state': 'changes_requested',
      state: 'finished'
    })]);

    await expectAsync(wait(['--build=123', '-f', '--pass-if-approved'])).toBeRejected();

    expect(logger.stderr).toEqual([]);
    expect(logger.stdout).toEqual([
      '[percy] Build #10 finished! https://percy.io/test/test/123',
      '[percy] Found 16 changes'
    ]);
  });

  it('does not error on diffs if the review status is approved and pass-if-approved is on', async () => {
    api.reply('/builds/123', () => [200, build({
      'total-comparisons-diff': 16,
      'review-state': 'approved',
      state: 'finished'
    })]);

    await wait(['--build=123', '-f', '--pass-if-approved']);

    expect(logger.stderr).toEqual([]);
    expect(logger.stdout).toEqual(jasmine.arrayContaining([
      '[percy] Build #10 finished! https://percy.io/test/test/123',
      '[percy] Found 16 changes'
    ]));
  });

  it('does not error when diffs are not found', async () => {
    api.reply('/builds/123', () => [200, build({
      'total-comparisons-diff': 0,
      state: 'finished'
    })]);

    await wait(['--build=123', '-f']);

    expect(logger.stderr).toEqual([]);
    expect(logger.stdout).toEqual(jasmine.arrayContaining([
      '[percy] Build #10 finished! https://percy.io/test/test/123',
      '[percy] Found 0 changes'
    ]));
  });

  it('errors and logs the build state when unrecognized', async () => {
    api.reply('/builds/123', () => [200, build({ state: 'expired' })]);
    await expectAsync(wait(['--build=123'])).toBeRejected();

    expect(logger.stdout).toEqual([]);
    expect(logger.stderr).toEqual(jasmine.arrayContaining([
      '[percy] Build #10 is expired. https://percy.io/test/test/123'
    ]));
  });

  it('stops waiting on process termination', async () => {
    api.reply('/builds/123', () => [200, build()]);

    let waiting = wait(['--build=123']);

    // wait a moment before terminating
    await new Promise(r => setTimeout(r, 100));
    await expectAsync(waiting).toBePending();

    process.emit('SIGTERM');
    await waiting;

    expect(logger.stderr).toEqual([]);
    expect(logger.stdout).toEqual([
      '[percy] Processing 18 snapshots - 0 of 72 comparisons finished...'
    ]);
  });

  describe('failure messages', () => {
    it('logs an error when there are no snapshots', async () => {
      api.reply('/builds/123', () => [200, build({
        state: 'failed',
        'failure-reason': 'render_timeout'
      })]);

      await expectAsync(wait(['--build=123'])).toBeRejected();

      expect(logger.stdout).toEqual([]);
      expect(logger.stderr).toEqual(jasmine.arrayContaining([
        '[percy] Build #10 failed! https://percy.io/test/test/123',
        '[percy] Some snapshots in this build took too long to render ' +
          'even after multiple retries.'
      ]));
    });

    it('logs an error when there are no snapshots', async () => {
      api.reply('/builds/123', () => [200, build({
        state: 'failed',
        'failure-reason': 'no_snapshots'
      })]);

      await expectAsync(wait(['--build=123'])).toBeRejected();

      expect(logger.stdout).toEqual([]);
      expect(logger.stderr).toEqual(jasmine.arrayContaining([
        '[percy] Build #10 failed! https://percy.io/test/test/123',
        '[percy] No snapshots were uploaded to this build.'
      ]));
    });

    it('logs an error when the build was not finalized', async () => {
      api.reply('/builds/123', () => [200, build({
        state: 'failed',
        'failure-reason': 'missing_finalize'
      })]);

      await expectAsync(wait(['--build=123'])).toBeRejected();

      expect(logger.stdout).toEqual([]);
      expect(logger.stderr).toEqual(jasmine.arrayContaining([
        '[percy] Build #10 failed! https://percy.io/test/test/123',
        '[percy] Failed to correctly finalize.'
      ]));
    });

    it('logs an error and exits when build is missing resources', async () => {
      api.reply('/builds/123', () => [200, build({
        state: 'failed',
        'failure-reason': 'missing_resources'
      })]);

      await expectAsync(wait(['--build=123'])).toBeRejected();

      expect(logger.stdout).toEqual([]);
      expect(logger.stderr).toEqual(jasmine.arrayContaining([
        '[percy] Build #10 failed! https://percy.io/test/test/123',
        '[percy] Some build or snapshot resources failed to correctly upload.'
      ]));
    });

    it('logs an error and exits when parallel builds are missing', async () => {
      api.reply('/builds/123', () => [200, build({
        state: 'failed',
        'failure-reason': 'missing_resources',
        'failure-details': {
          missing_parallel_builds: true,
          parallel_builds_received: 3,
          parallel_builds_expected: 4
        }
      })]);

      await expectAsync(wait(['--build=123'])).toBeRejected();

      expect(logger.stdout).toEqual([]);
      expect(logger.stderr).toEqual(jasmine.arrayContaining([
        '[percy] Build #10 failed! https://percy.io/test/test/123',
        '[percy] Only 3 of 4 parallel builds were received.'
      ]));
    });

    it('logs the failure reason and exits when the reason is unrecognized', async () => {
      api.reply('/builds/123', () => [200, build({
        state: 'failed',
        'failure-reason': 'unrecognized_reason'
      })]);

      await expectAsync(wait(['--build=123'])).toBeRejected();

      expect(logger.stdout).toEqual([]);
      expect(logger.stderr).toEqual(jasmine.arrayContaining([
        '[percy] Build #10 failed! https://percy.io/test/test/123',
        '[percy] Error: unrecognized_reason'
      ]));
    });

    it('logs an error if --pass-if-approved is provided without --fail-on-changes', async () => {
      await expectAsync(wait(['--build=123', '--pass-if-approved'])).toBeRejected();

      expect(logger.stdout).toEqual([]);
      expect(logger.stderr).toEqual(jasmine.arrayContaining([
        "[percy] ParseError: Options must be used together: '--pass-if-approved', '-f, --fail-on-changes'"
      ]));
    });
  });
});
