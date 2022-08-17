import { logger, setupTest } from '@percy/cli-command/test/helpers';
import { finalize } from '@percy/cli-build';

describe('percy build:finalize', () => {
  beforeEach(async () => {
    await setupTest();
  });

  afterEach(() => {
    delete process.env.PERCY_PARALLEL_TOTAL;
    delete process.env.PERCY_ENABLE;
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

    expect(process.env.PERCY_PARALLEL_TOTAL).toBeUndefined();
    await finalize();
    expect(process.env.PERCY_PARALLEL_TOTAL).toEqual('-1');
  });

  it('gets parallel build info and finalizes all parallel builds', async () => {
    process.env.PERCY_TOKEN = '<<PERCY_TOKEN>>';
    await finalize();

    expect(logger.stderr).toEqual([]);
    expect(logger.stdout).toEqual([
      '[percy] Finalizing parallel build...',
      '[percy] Finalized build #1: https://percy.io/test/test/123'
    ]);
  });
});
