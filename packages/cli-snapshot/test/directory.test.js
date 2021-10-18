import fs from 'fs';
import path from 'path';
import rimraf from 'rimraf';
import PercyConfig from '@percy/config';
import mockAPI from '@percy/client/test/helpers';
import logger from '@percy/logger/test/helpers';
import { Snapshot } from '../src/commands/snapshot';

describe('percy snapshot <directory>', () => {
  let tmp = path.join(__dirname, 'tmp');
  let cwd = process.cwd();

  beforeEach(() => {
    process.chdir(__dirname);
    fs.mkdirSync(tmp);

    fs.writeFileSync(path.join(tmp, 'test-1.html'), '<p>Test 1</p>');
    fs.writeFileSync(path.join(tmp, 'test-2.html'), '<p>Test 2</p>');
    fs.writeFileSync(path.join(tmp, 'test-3.html'), '<p>Test 3</p>');
    fs.writeFileSync(path.join(tmp, 'test-4.xml'), '<p>Test 4</p>');
    fs.writeFileSync(path.join(tmp, 'test-5.xml'), '<p>Test 5</p>');

    fs.mkdirSync(path.join(tmp, 'test-index'));
    fs.writeFileSync(path.join(tmp, 'test-index', 'index.html'), '<p>Test Index</p>');

    process.env.PERCY_TOKEN = '<<PERCY_TOKEN>>';
    mockAPI.start(50);
    logger.mock();
  });

  afterEach(() => {
    try { fs.unlinkSync('.percy.yml'); } catch {}
    try { fs.unlinkSync('.percy.js'); } catch {}
    process.chdir(cwd);
    rimraf.sync(tmp);

    delete process.env.PERCY_TOKEN;
    delete process.env.PERCY_ENABLE;
    process.removeAllListeners();
    PercyConfig.cache.clear();
  });

  it('errors when the base-url is invalid', async () => {
    await expectAsync(Snapshot.run(['./tmp', '--base-url=wrong']))
      .toBeRejectedWithError('EEXIT: 1');

    expect(logger.stdout).toEqual([]);
    expect(logger.stderr).toEqual([
      '[percy] Error: The base-url must begin with a forward slash (/) ' +
        'when snapshotting static directories'
    ]);
  });

  it('starts a static server and snapshots matching files', async () => {
    await Snapshot.run(['./tmp', '--include=test-*.html']);

    expect(logger.stderr).toEqual([]);
    expect(logger.stdout).toEqual(jasmine.arrayContaining([
      '[percy] Percy has started!',
      '[percy] Processing 3 snapshots...',
      '[percy] Snapshot taken: /test-1.html',
      '[percy] Snapshot taken: /test-2.html',
      '[percy] Snapshot taken: /test-3.html',
      '[percy] Finalized build #1: https://percy.io/test/test/123'
    ]));
  });

  it('snapshots matching files hosted with a base-url', async () => {
    await Snapshot.run(['./tmp', '--base-url=/base']);

    expect(logger.stderr).toEqual([]);
    expect(logger.stdout).toEqual(jasmine.arrayContaining([
      '[percy] Percy has started!',
      '[percy] Processing 4 snapshots...',
      '[percy] Snapshot taken: /base/test-1.html',
      '[percy] Snapshot taken: /base/test-2.html',
      '[percy] Snapshot taken: /base/test-3.html',
      '[percy] Snapshot taken: /base/test-index/index.html',
      '[percy] Finalized build #1: https://percy.io/test/test/123'
    ]));
  });

  it('does not take snapshots and prints a list with --dry-run', async () => {
    await Snapshot.run(['./tmp', '--dry-run']);

    expect(logger.stderr).toEqual([
      '[percy] Build not created'
    ]);
    expect(logger.stdout).toEqual([
      '[percy] Percy has started!',
      '[percy] Snapshot found: /test-1.html',
      '[percy] Snapshot found: /test-2.html',
      '[percy] Snapshot found: /test-3.html',
      '[percy] Snapshot found: /test-index/index.html',
      '[percy] Found 4 snapshots'
    ]);
  });

  it('accepts snapshot config overrides', async () => {
    fs.writeFileSync('.percy.yml', [
      'version: 2',
      'static:',
      '  overrides:',
      '  - additionalSnapshots:',
      '    - suffix: " (2)"',
      '  - include: "*-1.html"',
      '    name: First'
    ].join('\n'));

    await Snapshot.run(['./tmp', '--dry-run']);

    expect(logger.stderr).toEqual([
      '[percy] Build not created'
    ]);
    expect(logger.stdout).toEqual([
      '[percy] Percy has started!',
      '[percy] Snapshot found: First',
      '[percy] Snapshot found: First (2)',
      '[percy] Snapshot found: /test-2.html',
      '[percy] Snapshot found: /test-2.html (2)',
      '[percy] Snapshot found: /test-3.html',
      '[percy] Snapshot found: /test-3.html (2)',
      '[percy] Snapshot found: /test-index/index.html',
      '[percy] Snapshot found: /test-index/index.html (2)',
      '[percy] Found 8 snapshots'
    ]);
  });

  it('rewrites file and index URLs with --clean-urls', async () => {
    await Snapshot.run(['./tmp', '--dry-run', '--clean-urls']);

    expect(logger.stderr).toEqual([
      '[percy] Build not created'
    ]);
    expect(logger.stdout).toEqual([
      '[percy] Percy has started!',
      '[percy] Snapshot found: /test-1',
      '[percy] Snapshot found: /test-2',
      '[percy] Snapshot found: /test-3',
      '[percy] Snapshot found: /test-index',
      '[percy] Found 4 snapshots'
    ]);
  });

  it('rewrites URLs based on the provided rewrites config option', async () => {
    fs.writeFileSync('.percy.yml', [
      'version: 2',
      'static:',
      '  cleanUrls: true',
      '  rewrites:',
      '    /:path/:n: /:path-:n.html'
    ].join('\n'));

    await Snapshot.run(['./tmp', '--dry-run']);

    expect(logger.stderr).toEqual([
      '[percy] Build not created'
    ]);
    expect(logger.stdout).toEqual([
      '[percy] Percy has started!',
      '[percy] Snapshot found: /test/1',
      '[percy] Snapshot found: /test/2',
      '[percy] Snapshot found: /test/3',
      '[percy] Snapshot found: /test-index',
      '[percy] Found 4 snapshots'
    ]);
  });

  it('filters snapshots with include and exclude config options', async () => {
    fs.writeFileSync('.percy.js', [
      'module.exports = {',
      '  version: 2,',
      '  static: {',
      '    include: /\\d$/,',
      '    exclude: snap => (snap.name.split("-")[1] % 2 === 0),',
      '    cleanUrls: true',
      '  }',
      '}'
    ].join('\n'));

    await Snapshot.run(['./tmp', '--dry-run']);

    expect(logger.stderr).toEqual([
      '[percy] Build not created'
    ]);
    expect(logger.stdout).toEqual([
      '[percy] Percy has started!',
      '[percy] Snapshot found: /test-1',
      '[percy] Snapshot found: /test-3',
      '[percy] Found 2 snapshots'
    ]);
  });
});
