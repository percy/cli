import { logger, setupTest, fs } from '@percy/cli-command/test/helpers';
import snapshot from '../src/snapshot';

describe('percy snapshot <directory>', () => {
  beforeEach(async () => {
    process.env.PERCY_TOKEN = '<<PERCY_TOKEN>>';

    await setupTest({
      filesystem: {
        'test-1.html': '<p>Test 1</p>',
        'test-2.html': '<p>Test 2</p>',
        'test-3.html': '<p>Test 3</p>',
        'test-4.xml': '<p>Test 4</p>',
        'test-5.xml': '<p>Test 5</p>',
        'test-index/index.html': '<p>Test Index</p>'
      }
    });
  });

  afterEach(() => {
    delete process.env.PERCY_TOKEN;
    delete process.env.PERCY_ENABLE;
  });

  it('errors when the base-url is invalid', async () => {
    await expectAsync(
      snapshot(['./', '--base-url=wrong'])
    ).toBeRejected();

    expect(logger.stdout).toEqual([]);
    expect(logger.stderr).toEqual([
      '[percy] Error: The \'--base-url\' flag must start with a ' +
        'forward slash (/) when providing a static directory'
    ]);
  });

  it('starts a static server and snapshots matching files', async () => {
    await snapshot(['./', '--include=test-*.html']);

    expect(logger.stderr).toEqual([]);
    expect(logger.stdout).toEqual(jasmine.arrayContaining([
      '[percy] Percy has started!',
      '[percy] Snapshot taken: /test-1.html',
      '[percy] Snapshot taken: /test-2.html',
      '[percy] Snapshot taken: /test-3.html',
      '[percy] Uploading 3 snapshots...',
      '[percy] Finalized build #1: https://percy.io/test/test/123'
    ]));
  });

  it('snapshots matching files hosted with a base-url', async () => {
    await snapshot(['./', '--base-url=/base']);

    expect(logger.stderr).toEqual([]);
    expect(logger.stdout).toEqual(jasmine.arrayContaining([
      '[percy] Percy has started!',
      '[percy] Snapshot taken: /base/test-1.html',
      '[percy] Snapshot taken: /base/test-2.html',
      '[percy] Snapshot taken: /base/test-3.html',
      '[percy] Snapshot taken: /base/test-index/index.html',
      '[percy] Uploading 4 snapshots...',
      '[percy] Finalized build #1: https://percy.io/test/test/123'
    ]));
  });

  it('does not take snapshots and prints a list with --dry-run', async () => {
    await snapshot(['./', '--dry-run']);

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
      '  options:',
      '  - additionalSnapshots:',
      '    - suffix: " (2)"',
      '  - include: "*-1.html"',
      '    name: First'
    ].join('\n'));

    await snapshot(['./', '--dry-run']);

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
    await snapshot(['./', '--dry-run', '--clean-urls']);

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

    await snapshot(['./', '--dry-run']);

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

    await snapshot(['./', '--dry-run']);

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
