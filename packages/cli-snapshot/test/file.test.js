import fs from 'fs';
import path from 'path';
import { inspect } from 'util';
import rimraf from 'rimraf';
import { logger, mockAPI, createTestServer } from '@percy/core/test/helpers';
import snapshot from '../src/snapshot';

describe('percy snapshot <file>', () => {
  let tmp = path.join(__dirname, 'tmp');
  let cwd = process.cwd();
  let server;

  beforeEach(async () => {
    fs.mkdirSync(tmp);
    process.chdir(tmp);

    server = await createTestServer({
      default: () => [200, 'text/html', '<p>Test</p>']
    });

    fs.writeFileSync('pages.yml', [
      '- name: YAML Snapshot',
      '  url: http://localhost:8000'
    ].join('\n'));

    fs.writeFileSync('pages.js', 'module.exports = ' + inspect([{
      name: 'JS Snapshot',
      url: 'http://localhost:8000',
      additionalSnapshots: [
        { suffix: ' 2' },
        { prefix: 'Other ' }
      ]
    }], { depth: null }));

    fs.writeFileSync('pages-fn.js', 'module.exports = () => (' + inspect([{
      name: 'JS Function Snapshot',
      url: 'http://localhost:8000'
    }], { depth: null }) + ')');

    fs.writeFileSync('pages-default.js', 'export default ' + inspect([{
      name: 'JS Default Snapshot',
      url: 'http://localhost:8000'
    }], { depth: null }));

    fs.writeFileSync('urls.yml', [
      '- /', '- /one', '- /two'
    ].join('\n'));

    process.env.PERCY_TOKEN = '<<PERCY_TOKEN>>';
    mockAPI.start(50);
    logger.mock();
  });

  afterEach(async () => {
    process.chdir(cwd);
    rimraf.sync(path.join(__dirname, 'tmp'));

    delete process.env.PERCY_TOKEN;
    await server.close();
  });

  it('errors when the base-url is invalid', async () => {
    await expectAsync(
      snapshot(['./pages.yml', '--base-url=/wrong'])
    ).toBeRejected();

    expect(logger.stdout).toEqual([]);
    expect(logger.stderr).toEqual([
      '[percy] Error: The \'--base-url\' flag must include ' +
        'a protocol and hostname when providing a list of snapshots'
    ]);
  });

  it('errors with unknown file extensions', async () => {
    fs.writeFileSync('nope', 'not here');
    await expectAsync(snapshot(['./nope'])).toBeRejected();

    expect(logger.stdout).toEqual([]);
    expect(logger.stderr).toEqual([
      '[percy] Error: Unsupported filetype: ./nope'
    ]);
  });

  it('errors when a page url is invalid', async () => {
    await expectAsync(snapshot(['./urls.yml'])).toBeRejected();

    expect(logger.stdout).toEqual([
      '[percy] Percy has started!',
      '[percy] Stopping percy...'
    ]);
    expect(logger.stderr).toEqual([
      '[percy] Build not created',
      '[percy] Error: Invalid snapshot URL: /'
    ]);
  });

  it('snapshots pages from .yaml files', async () => {
    await snapshot(['./pages.yml']);

    expect(logger.stderr).toEqual([]);
    expect(logger.stdout).toEqual([
      '[percy] Percy has started!',
      '[percy] Snapshot taken: YAML Snapshot',
      '[percy] Uploading 1 snapshot...',
      '[percy] Finalized build #1: https://percy.io/test/test/123'
    ]);
  });

  it('snapshots pages from .json files', async () => {
    fs.writeFileSync('pages.json', JSON.stringify([{
      name: 'JSON Snapshot',
      url: 'http://localhost:8000'
    }]));

    await snapshot(['./pages.json']);

    expect(logger.stderr).toEqual([]);
    expect(logger.stdout).toEqual([
      '[percy] Percy has started!',
      '[percy] Snapshot taken: JSON Snapshot',
      '[percy] Uploading 1 snapshot...',
      '[percy] Finalized build #1: https://percy.io/test/test/123'
    ]);
  });

  it('snapshots pages from .js files', async () => {
    await snapshot(['./pages.js']);

    expect(logger.stderr).toEqual([]);
    expect(logger.stdout).toEqual([
      '[percy] Percy has started!',
      '[percy] Snapshot taken: JS Snapshot',
      '[percy] Snapshot taken: JS Snapshot 2',
      '[percy] Snapshot taken: Other JS Snapshot',
      '[percy] Uploading 3 snapshots...',
      '[percy] Finalized build #1: https://percy.io/test/test/123'
    ]);
  });

  it('snapshots pages from .js files that export a function', async () => {
    await snapshot(['./pages-fn.js']);

    expect(logger.stderr).toEqual([]);
    expect(logger.stdout).toEqual([
      '[percy] Percy has started!',
      '[percy] Snapshot taken: JS Function Snapshot',
      '[percy] Uploading 1 snapshot...',
      '[percy] Finalized build #1: https://percy.io/test/test/123'
    ]);
  });

  it('snapshots pages from .js files that have a default export', async () => {
    await snapshot(['./pages-default.js']);

    expect(logger.stderr).toEqual([]);
    expect(logger.stdout).toEqual([
      '[percy] Percy has started!',
      '[percy] Snapshot taken: JS Default Snapshot',
      '[percy] Uploading 1 snapshot...',
      '[percy] Finalized build #1: https://percy.io/test/test/123'
    ]);
  });

  it('snapshots pages from a list of URLs', async () => {
    await snapshot(['./urls.yml', '--base-url=http://localhost:8000']);

    expect(logger.stderr).toEqual([]);
    expect(logger.stdout).toEqual(jasmine.arrayContaining([
      '[percy] Percy has started!',
      '[percy] Snapshot taken: /',
      '[percy] Snapshot taken: /one',
      '[percy] Snapshot taken: /two',
      '[percy] Uploading 3 snapshots...',
      '[percy] Finalized build #1: https://percy.io/test/test/123'
    ]));
  });

  it('can filter snapshots with --include or --exclude', async () => {
    /* eslint-disable no-template-curly-in-string */
    fs.writeFileSync('lengthy.js', [
      'module.exports = Array.from({ length: 100 }, (_, i) => ({',
      '  name: `Snapshot #${i + 1}`,',
      '  url: `http://localhost:8000/${i + 1}`',
      '}))'
    ].join('\n'));
    /* eslint-enable no-template-curly-in-string */

    await snapshot(['./lengthy.js', '--include=*2', '--exclude=[13579]']);

    expect(logger.stderr).toEqual([]);
    expect(logger.stdout).toEqual(jasmine.arrayContaining([
      '[percy] Percy has started!',
      '[percy] Snapshot taken: Snapshot #2',
      '[percy] Snapshot taken: Snapshot #22',
      '[percy] Snapshot taken: Snapshot #42',
      '[percy] Snapshot taken: Snapshot #62',
      '[percy] Snapshot taken: Snapshot #82',
      '[percy] Uploading 5 snapshots...',
      '[percy] Finalized build #1: https://percy.io/test/test/123'
    ]));
  });

  it('does not take snapshots and prints a list with --dry-run', async () => {
    await snapshot(['./pages.yml', '--dry-run']);
    expect(logger.stderr).toEqual([
      '[percy] Build not created'
    ]);
    expect(logger.stdout).toEqual([
      '[percy] Percy has started!',
      '[percy] Snapshot found: YAML Snapshot',
      '[percy] Found 1 snapshot'
    ]);

    logger.reset();

    await snapshot(['./pages.js', '--dry-run']);

    expect(logger.stderr).toEqual([
      '[percy] Build not created'
    ]);
    expect(logger.stdout).toEqual([
      '[percy] Percy has started!',
      '[percy] Snapshot found: JS Snapshot',
      '[percy] Snapshot found: JS Snapshot 2',
      '[percy] Snapshot found: Other JS Snapshot',
      '[percy] Found 3 snapshots'
    ]);
  });

  it('logs validation warnings', async () => {
    fs.writeFileSync('invalid.yml', [
      'snapshots:',
      '  - foo: bar',
      '    name: Test snap'
    ].join('\n'));

    await expectAsync(
      snapshot(['./invalid.yml', '--dry-run'])
    ).toBeRejected();

    expect(logger.stdout).toEqual([
      '[percy] Percy has started!',
      '[percy] Stopping percy...'
    ]);
    expect(logger.stderr).toEqual([
      '[percy] Invalid snapshot options:',
      '[percy] - snapshots[0].url: missing required property',
      '[percy] - snapshots[0].foo: unknown property',
      '[percy] Build not created',
      '[percy] Error: No snapshots found'
    ]);
  });
});
