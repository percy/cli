import { logger, setupTest } from '@percy/cli-command/test/helpers';
import api from '@percy/client/test/helpers';
import { finalize } from '@percy/cli-build';

describe('percy build:finalize', () => {
  beforeEach(async () => {
    await setupTest();
    // Keep the readiness-gate fast in all tests by default
    process.env.PERCY_FINALIZE_QUIET_WINDOW_MS = '0';
    process.env.PERCY_FINALIZE_INTERVAL_MS = '10';
  });

  afterEach(() => {
    delete process.env.PERCY_PARALLEL_TOTAL;
    delete process.env.PERCY_ENABLE;
    delete process.env.PERCY_FINALIZE_QUIET_WINDOW_MS;
    delete process.env.PERCY_FINALIZE_INTERVAL_MS;
    delete process.env.PERCY_FINALIZE_TIMEOUT_MS;
  });

  it('does nothing and logs when percy is not enabled', async () => {
    process.env.PERCY_ENABLE = '0';
    await finalize();

    expect(logger.stdout).toEqual([]);
    expect(logger.stderr).toEqual([
      '[percy] Percy is disabled'
    ]);
  });

  it('logs an error when PERCY_PARALLEL_TOTAL is not -1', async () => {
    process.env.PERCY_PARALLEL_TOTAL = '5';
    await expectAsync(finalize()).toBeRejected();

    expect(logger.stdout).toEqual([]);
    expect(logger.stderr).toEqual([
      '[percy] This command should only be used with PERCY_PARALLEL_TOTAL=-1',
      '[percy] Current value is "5"'
    ]);
  });

  it('defaults PERCY_PARALLEL_TOTAL to -1', async () => {
    process.env.PERCY_TOKEN = '<<PERCY_TOKEN>>';
    process.env.PERCY_FORCE_PKG_VALUE = JSON.stringify({ name: '@percy/client', version: '1.0.0' });
    expect(process.env.PERCY_PARALLEL_TOTAL).toBeUndefined();
    await finalize();
    expect(process.env.PERCY_PARALLEL_TOTAL).toEqual('-1');
  });

  it('gets parallel build info and finalizes all parallel builds', async () => {
    process.env.PERCY_TOKEN = '<<PERCY_TOKEN>>';
    process.env.PERCY_FORCE_PKG_VALUE = JSON.stringify({ name: '@percy/client', version: '1.0.0' });
    await finalize();

    expect(logger.stderr).toEqual([]);
    expect(logger.stdout).toEqual([
      '[percy] Finalizing parallel build...',
      '[percy] Finalized build #1: https://percy.io/test/test/123'
    ]);
  });

  it('should reject promise if finalize fails', async () => {
    process.env.PERCY_TOKEN = '<<PERCY_TOKEN>>';
    api.reply('/builds/123/finalize?all-shards=true', () => [500, new Error('Failed')]);

    await expectAsync(finalize()).toBeRejected();

    expect(logger.stderr).toEqual(['[percy] Error: Percy build failed during finalize']);
  });

  describe('readiness gate before all-shards finalize', () => {
    beforeEach(() => {
      process.env.PERCY_TOKEN = '<<PERCY_TOKEN>>';
      process.env.PERCY_FORCE_PKG_VALUE = JSON.stringify({ name: '@percy/client', version: '1.0.0' });
    });

    it('polls build until snapshot count stabilizes before finalizing', async () => {
      // Use a 50ms quiet window so the gate actually waits for stability.
      process.env.PERCY_FINALIZE_QUIET_WINDOW_MS = '50';

      // Simulate two shards still uploading: count grows 2 → 5, then stays at 5
      api
        .reply('/builds/123', () => [200, {
          data: { id: '123', attributes: { 'build-number': 1, 'web-url': 'https://percy.io/test/test/123', 'total-snapshots': 2 } }
        }])
        .reply('/builds/123', () => [200, {
          data: { id: '123', attributes: { 'build-number': 1, 'web-url': 'https://percy.io/test/test/123', 'total-snapshots': 5 } }
        }]);

      await finalize();

      // Polled at least twice: once for 2-snaps, once for 5-snaps (count changed → reset window)
      expect(api.requests['/builds/123'].length).toBeGreaterThanOrEqual(2);
      expect(api.requests['/builds/123/finalize?all-shards=true']).toBeDefined();

      expect(logger.stderr).toEqual([]);
      expect(logger.stdout).toEqual([
        '[percy] Finalizing parallel build...',
        '[percy] Finalized build #1: https://percy.io/test/test/123'
      ]);
    });

    it('finalizes immediately when snapshot count is already stable', async () => {
      // Default /builds/123 reply returns total-snapshots: 0 (stable from first poll)
      await finalize();

      expect(api.requests['/builds/123']).toBeDefined();
      expect(api.requests['/builds/123/finalize?all-shards=true']).toBeDefined();
    });

    it('rejects and logs when readiness check times out', async () => {
      // Set tiny timeout so it expires before the quiet window is satisfied
      process.env.PERCY_FINALIZE_TIMEOUT_MS = '50';
      process.env.PERCY_FINALIZE_QUIET_WINDOW_MS = '200';

      // Count never changes, but quiet window (200ms) > timeout (50ms) — times out.
      // The timeout error bubbles into the catch block which calls exit(1, ...).
      await expectAsync(finalize()).toBeRejected();

      expect(logger.stderr).toEqual(jasmine.arrayContaining([
        '[percy] Error: Percy build failed during finalize'
      ]));
    });

    it('finalizes successfully despite an intermittent readiness check poll failure', async () => {
      // Queue two replies: a 500 error followed by a stable 200.
      // The client's internal retry logic will consume the 500 on its first attempt
      // and succeed with the 200 on the retry, so getBuild resolves successfully.
      api
        .reply('/builds/123', () => [500, { errors: [{ detail: 'server error' }] }])
        .reply('/builds/123', () => [200, {
          data: { id: '123', attributes: { 'build-number': 1, 'web-url': 'https://percy.io/test/test/123', 'total-snapshots': 0 } }
        }]);

      await finalize();

      expect(api.requests['/builds/123/finalize?all-shards=true']).toBeDefined();
    });
  });
});
