import { fs, logger, setupTest, api } from '@percy/cli-command/test/helpers';
import { serializeSnapshot } from '@percy/core/archive';
import { replay } from '../src/replay.js';

describe('percy snapshot:replay', () => {
  beforeEach(async () => {
    replay.packageInformation = { name: '@percy/cli-snapshot' };
    process.env.PERCY_TOKEN = '<<PERCY_TOKEN>>';
    process.env.PERCY_FORCE_PKG_VALUE = JSON.stringify({ name: '@percy/client', version: '1.0.0' });
    process.env.PERCY_CLIENT_ERROR_LOGS = false;
  });

  afterEach(() => {
    delete process.env.PERCY_TOKEN;
    delete process.env.PERCY_FORCE_PKG_VALUE;
    delete process.env.PERCY_CLIENT_ERROR_LOGS;
    delete process.env.PERCY_ENABLE;
    delete replay.packageInformation;
  });

  it('skips when Percy is disabled', async () => {
    process.env.PERCY_ENABLE = '0';
    await setupTest({
      filesystem: { 'archive/.keep': '' }
    });
    await replay(['./archive']);

    expect(logger.stdout).toEqual([]);
    expect(logger.stderr).toEqual(jasmine.arrayContaining([
      '[percy] Percy is disabled'
    ]));
  });

  it('errors when the provided path does not exist', async () => {
    await setupTest();
    await expectAsync(replay(['./nonexistent'])).toBeRejected();

    expect(logger.stderr).toEqual(jasmine.arrayContaining([
      '[percy] Error: Not found: ./nonexistent'
    ]));
  });

  it('errors when the provided path is not a directory', async () => {
    await setupTest({
      filesystem: { 'not-a-dir.txt': 'hello' }
    });

    await expectAsync(replay(['./not-a-dir.txt'])).toBeRejected();

    expect(logger.stderr).toEqual(jasmine.arrayContaining([
      '[percy] Error: Not a directory: ./not-a-dir.txt'
    ]));
  });

  it('errors when the archive directory is empty', async () => {
    await setupTest({
      filesystem: { 'archive/.keep': '' }
    });

    // remove the .keep file so only the directory exists
    fs.unlinkSync('archive/.keep');

    await expectAsync(replay(['./archive'])).toBeRejected();

    expect(logger.stderr).toEqual(jasmine.arrayContaining([
      '[percy] Error: No valid snapshots found in archive'
    ]));
  });

  it('uploads archived snapshots to Percy', async () => {
    let archived = serializeSnapshot({
      name: 'Test Snapshot',
      url: 'http://localhost:8000',
      widths: [1280],
      minHeight: 1024,
      resources: [{
        url: 'http://localhost:8000/',
        sha: 'abc123',
        mimetype: 'text/html',
        root: true,
        content: Buffer.from('<p>Test</p>')
      }]
    });

    await setupTest({
      filesystem: {
        'archive/Test_Snapshot-snapshot.json': JSON.stringify(archived)
      }
    });

    await replay(['./archive']);

    expect(logger.stdout).toEqual(jasmine.arrayContaining([
      '[percy] Percy has started!',
      jasmine.stringMatching('\\[percy\\] Replaying snapshot: Test Snapshot')
    ]));
  });

  it('skips invalid archive files with warnings', async () => {
    let valid = serializeSnapshot({
      name: 'Valid Snapshot',
      url: 'http://localhost:8000',
      widths: [1280],
      minHeight: 1024,
      resources: [{
        url: 'http://localhost:8000/',
        sha: 'abc123',
        mimetype: 'text/html',
        root: true,
        content: Buffer.from('<p>Test</p>')
      }]
    });

    await setupTest({
      filesystem: {
        'archive/valid.json': JSON.stringify(valid),
        'archive/invalid.json': '{ "not": "a valid archive" }'
      }
    });

    await replay(['./archive']);

    expect(logger.stderr).toEqual(jasmine.arrayContaining([
      jasmine.stringMatching('\\[percy\\] Skipping invalid archive file')
    ]));
    expect(logger.stdout).toEqual(jasmine.arrayContaining([
      jasmine.stringMatching('\\[percy\\] Replaying snapshot: Valid Snapshot')
    ]));
  });
});
