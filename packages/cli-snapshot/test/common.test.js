import { logger, setupTest } from '@percy/cli-command/test/helpers';
import snapshot from '@percy/cli-snapshot';

describe('percy snapshot', () => {
  beforeEach(async () => {
    snapshot.packageInformation = { name: '@percy/cli-snapshot' };
    await setupTest();
  });

  afterEach(() => {
    delete process.env.PERCY_ENABLE;
    delete snapshot.packageInformation;
  });

  it('skips snapshotting when Percy is disabled', async () => {
    process.env.PERCY_ENABLE = '0';
    await snapshot(['./']);

    expect(logger.stdout).toEqual([]);
    expect(logger.stderr).toEqual([
      '[percy] Percy is disabled'
    ]);
  });

  it('errors when the provided path doesn\'t exist', async () => {
    await expectAsync(snapshot(['./404'])).toBeRejected();

    expect(logger.stdout).toEqual([]);
    expect(logger.stderr).toEqual([
      '[percy] Error: Not found: ./404'
    ]);
  });

  it('errors when there are no snapshots to take', async () => {
    await expectAsync(snapshot(['./'])).toBeRejected();

    expect(logger.stdout).toEqual(jasmine.arrayContaining([
      '[percy] Percy has started!',
      '[percy] Stopping percy...'
    ]));
    expect(logger.stderr).toEqual(jasmine.arrayContaining([
      '[percy] Build not created',
      '[percy] Error: No snapshots found'
    ]));
  });
});
