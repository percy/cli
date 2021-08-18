import fs from 'fs';
import rimraf from 'rimraf';
import logger from '@percy/logger/test/helpers';
import { Snapshot } from '../src/commands/snapshot';

require('../src/hooks/init').default();

describe('percy snapshot', () => {
  beforeEach(() => {
    fs.mkdirSync('tmp');
    logger.mock();
  });

  afterEach(() => {
    delete process.env.PERCY_ENABLE;
    process.removeAllListeners();
    rimraf.sync('tmp');
  });

  it('skips snapshotting when Percy is disabled', async () => {
    process.env.PERCY_ENABLE = '0';
    await Snapshot.run(['./public']);

    expect(logger.stderr).toEqual([]);
    expect(logger.stdout).toEqual([
      '[percy] Percy is disabled. Skipping snapshots'
    ]);
  });

  it('errors when the provided path doesn\'t exist', async () => {
    await expectAsync(Snapshot.run(['./404']))
      .toBeRejectedWithError('EEXIT: 1');

    expect(logger.stdout).toEqual([]);
    expect(logger.stderr).toEqual([
      '[percy] Error: Not found: ./404'
    ]);
  });

  it('errors when there are no snapshots to take', async () => {
    await expectAsync(Snapshot.run(['./tmp']))
      .toBeRejectedWithError('EEXIT: 1');

    expect(logger.stdout).toEqual([]);
    expect(logger.stderr).toEqual([
      '[percy] Error: No snapshots found'
    ]);
  });
});
