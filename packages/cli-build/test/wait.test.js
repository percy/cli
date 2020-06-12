import expect from 'expect';
import stdio from '@percy/logger/test/helper';
import mockAPI from '@percy/client/test/helper';
import mockgit from '@percy/env/test/mockgit';
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
  });

  afterEach(() => {
    delete process.env.PERCY_TOKEN;
    delete process.env.PERCY_ENABLE;
    process.removeAllListeners();
  });

  it('does nothing and logs when percy is not enabled', async () => {
    process.env.PERCY_ENABLE = '0';
    await stdio.capture(() => Wait.run([]));

    expect(stdio[2]).toHaveLength(0);
    expect(stdio[1]).toEqual([
      '[percy] Percy is disabled\n'
    ]);
  });

  it('logs an error when required args are missing', async () => {
    await expect(stdio.capture(() => Wait.run([])))
      .rejects.toThrow('Missing build ID or commit SHA');
    expect(stdio[1]).toHaveLength(0);
    expect(stdio[2]).toEqual([
      '[percy] Error: Missing build ID or commit SHA\n'
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

    await stdio.capture(() => Wait.run(['--build=123', '--interval=50']));

    expect(stdio[2]).toHaveLength(0);
    expect(stdio[1]).toEqual(expect.arrayContaining([
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

    await stdio.capture(() => Wait.run(['--build=123', '--interval=50']));

    expect(stdio[2]).toHaveLength(0);
    expect(stdio[1]).toEqual(expect.arrayContaining([
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

    await stdio.capture(() => Wait.run(['--build=123']));

    expect(stdio[2]).toHaveLength(0);
    expect(stdio[1]).toEqual(expect.arrayContaining([
      '[percy] Build #10 finished! https://percy.io/test/test/123\n',
      '[percy] Found 16 changes\n'
    ]));
  });

  it('exits and logs the build state when unrecognized', async () => {
    mockAPI.reply('/builds/123', () => [200, build({ state: 'expired' })]);
    await expect(stdio.capture(() => Wait.run(['--build=123'])))
      .rejects.toThrow('EEXIT: 1');

    expect(stdio[1]).toHaveLength(0);
    expect(stdio[2]).toEqual(expect.arrayContaining([
      '[percy] Build #10 is expired. https://percy.io/test/test/123\n'
    ]));
  });

  it('can parse a commit revision', async () => {
    mockgit.commit(([, rev]) => rev === 'HEAD' && 'parsed-commit-sha');
    mockAPI.reply('/projects/my-project/builds?filter[sha]=parsed-commit-sha', () => [200, {
      data: [build({ 'total-comparisons-diff': 12, state: 'finished' }).data]
    }]);

    await stdio.capture(() => Wait.run(['--project=my-project', '--commit=HEAD']));

    expect(stdio[2]).toHaveLength(0);
    expect(stdio[1]).toEqual(expect.arrayContaining([
      '[percy] Build #10 finished! https://percy.io/test/test/123\n',
      '[percy] Found 12 changes\n'
    ]));
  });

  it('defaults to the provided commit when parsing fails', async () => {
    mockgit.commit(() => { throw new Error('test'); });
    mockAPI.reply('/projects/my-project/builds?filter[sha]=HEAD', () => [200, {
      data: [build({ 'total-comparisons-diff': 12, state: 'finished' }).data]
    }]);

    await stdio.capture(() => Wait.run(['--project=my-project', '--commit=HEAD']));

    expect(stdio[2]).toHaveLength(0);
    expect(stdio[1]).toEqual(expect.arrayContaining([
      '[percy] Build #10 finished! https://percy.io/test/test/123\n',
      '[percy] Found 12 changes\n'
    ]));
  });

  describe('failure messages', () => {
    it('logs an error and exits when there are no snapshots', async () => {
      mockAPI.reply('/builds/123', () => [200, build({
        state: 'failed',
        'failure-reason': 'render_timeout'
      })]);

      await expect(stdio.capture(() => Wait.run(['--build=123'])))
        .rejects.toThrow('EEXIT: 1');

      expect(stdio[1]).toHaveLength(0);
      expect(stdio[2]).toEqual(expect.arrayContaining([
        '[percy] Build #10 failed! https://percy.io/test/test/123\n',
        '[percy] Some snapshots in this build took too long to render ' +
          'even after multiple retries.\n'
      ]));
    });

    it('logs an error and exits when there are no snapshots', async () => {
      mockAPI.reply('/builds/123', () => [200, build({
        state: 'failed',
        'failure-reason': 'no_snapshots'
      })]);

      await expect(stdio.capture(() => Wait.run(['--build=123'])))
        .rejects.toThrow('EEXIT: 1');

      expect(stdio[1]).toHaveLength(0);
      expect(stdio[2]).toEqual(expect.arrayContaining([
        '[percy] Build #10 failed! https://percy.io/test/test/123\n',
        '[percy] No snapshots were uploaded to this build.\n'
      ]));
    });

    it('logs an error and exits when the build was not finalized', async () => {
      mockAPI.reply('/builds/123', () => [200, build({
        state: 'failed',
        'failure-reason': 'missing_finalize'
      })]);

      await expect(stdio.capture(() => Wait.run(['--build=123'])))
        .rejects.toThrow('EEXIT: 1');

      expect(stdio[1]).toHaveLength(0);
      expect(stdio[2]).toEqual(expect.arrayContaining([
        '[percy] Build #10 failed! https://percy.io/test/test/123\n',
        '[percy] Failed to correctly finalize.\n'
      ]));
    });

    it('logs an error and exits when build is missing resources', async () => {
      mockAPI.reply('/builds/123', () => [200, build({
        state: 'failed',
        'failure-reason': 'missing_resources'
      })]);

      await expect(stdio.capture(() => Wait.run(['--build=123'])))
        .rejects.toThrow('EEXIT: 1');

      expect(stdio[1]).toHaveLength(0);
      expect(stdio[2]).toEqual(expect.arrayContaining([
        '[percy] Build #10 failed! https://percy.io/test/test/123\n',
        '[percy] Some build or snapshot resources failed to correctly upload.\n'
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

      await expect(stdio.capture(() => Wait.run(['--build=123'])))
        .rejects.toThrow('EEXIT: 1');

      expect(stdio[1]).toHaveLength(0);
      expect(stdio[2]).toEqual(expect.arrayContaining([
        '[percy] Build #10 failed! https://percy.io/test/test/123\n',
        '[percy] Only 3 of 4 parallelized build processes finished.\n'
      ]));
    });

    it('logs the failure reason and exits when the reason is unrecognized', async () => {
      mockAPI.reply('/builds/123', () => [200, build({
        state: 'failed',
        'failure-reason': 'unrecognized_reason'
      })]);

      await expect(stdio.capture(() => Wait.run(['--build=123'])))
        .rejects.toThrow('EEXIT: 1');

      expect(stdio[1]).toHaveLength(0);
      expect(stdio[2]).toEqual(expect.arrayContaining([
        '[percy] Build #10 failed! https://percy.io/test/test/123\n',
        '[percy] Error: unrecognized_reason\n'
      ]));
    });
  });
});
