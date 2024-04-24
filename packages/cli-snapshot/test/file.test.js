import { inspect } from 'util';
import { fs, logger, setupTest, createTestServer } from '@percy/cli-command/test/helpers';
import snapshot from '@percy/cli-snapshot';

describe('percy snapshot <file>', () => {
  let server;

  beforeEach(async () => {
    snapshot.packageInformation = { name: '@percy/cli-snapshot' };
    process.env.PERCY_TOKEN = '<<PERCY_TOKEN>>';

    server = await createTestServer({
      default: () => [200, 'text/html', '<p>Test</p>']
    });

    await setupTest({
      filesystem: {
        'pages.yml': [
          '- name: YAML Snapshot',
          '  url: http://localhost:8000'
        ].join('\n'),

        'pages.js': 'module.exports = ' + inspect([{
          name: 'JS Snapshot',
          url: 'http://localhost:8000',
          additionalSnapshots: [
            { suffix: ' 2' },
            { prefix: 'Other ' }
          ]
        }], { depth: null }),

        'pages-fn.cjs': 'module.exports = () => (' + inspect([{
          name: 'JS Function Snapshot',
          url: 'http://localhost:8000'
        }], { depth: null }) + ')',

        'urls.yml': [
          '- /', '- /one', '- /two'
        ].join('\n')
      }
    });
    process.env.PERCY_CLIENT_ERROR_LOGS = false;
  });

  afterEach(async () => {
    delete process.env.PERCY_TOKEN;
    delete process.env.PERCY_CLIENT_ERROR_LOGS;
    delete snapshot.packageInformation;
    await server.close();
  });

  it('errors when the base-url is invalid', async () => {
    await expectAsync(
      snapshot(['./pages.yml', '--base-url=/wrong'])
    ).toBeRejected();

    expect(logger.stdout).toEqual([]);
    expect(logger.stderr).toEqual(jasmine.arrayContaining([
      '[percy] Error: The \'--base-url\' flag must include ' +
        'a protocol and hostname when providing a list of snapshots'
    ]));
  });

  it('errors with unknown file extensions', async () => {
    fs.writeFileSync('nope', 'not here');
    await expectAsync(snapshot(['./nope'])).toBeRejected();

    expect(logger.stdout).toEqual([
      "[percy] Build's CLI logs sent successfully. Please share this log ID with Percy team in case of any issues - random_sha"
    ]);
    expect(logger.stderr).toEqual(jasmine.arrayContaining([
      '[percy] Error: Unsupported filetype: ./nope'
    ]));
  });

  it('errors when a page url is invalid', async () => {
    await expectAsync(snapshot(['./urls.yml'])).toBeRejected();

    expect(logger.stdout).toEqual(jasmine.arrayContaining([
      '[percy] Percy has started!',
      '[percy] Stopping percy...'
    ]));
    expect(logger.stderr).toEqual(jasmine.arrayContaining([
      '[percy] Build not created',
      '[percy] Error: Invalid snapshot URL: /'
    ]));
  });

  it('snapshots pages from .yaml files', async () => {
    await snapshot(['./pages.yml']);

    expect(logger.stderr).toEqual([]);
    expect(logger.stdout).toEqual(jasmine.arrayContaining([
      '[percy] Percy has started!',
      '[percy] Snapshot taken: YAML Snapshot',
      '[percy] Uploading 1 snapshot...',
      '[percy] Finalized build #1: https://percy.io/test/test/123'
    ]));
  });

  it('snapshots pages from .json files', async () => {
    fs.writeFileSync('pages.json', JSON.stringify([{
      name: 'JSON Snapshot',
      url: 'http://localhost:8000'
    }]));

    await snapshot(['./pages.json']);

    expect(logger.stderr).toEqual([]);
    expect(logger.stdout).toEqual(jasmine.arrayContaining([
      '[percy] Percy has started!',
      '[percy] Snapshot taken: JSON Snapshot',
      '[percy] Uploading 1 snapshot...',
      '[percy] Finalized build #1: https://percy.io/test/test/123'
    ]));
  });

  it('snapshots pages from .js files', async () => {
    await snapshot(['./pages.js']);

    expect(logger.stderr).toEqual([]);
    expect(logger.stdout).toEqual(jasmine.arrayContaining([
      '[percy] Percy has started!',
      '[percy] Snapshot taken: JS Snapshot',
      '[percy] Snapshot taken: JS Snapshot 2',
      '[percy] Snapshot taken: Other JS Snapshot',
      jasmine.stringMatching('\\[percy\\] Uploading \\d snapshots?'),
      '[percy] Finalized build #1: https://percy.io/test/test/123'
    ]));
  });

  it('snapshots pages from .js files that export a function', async () => {
    await snapshot(['./pages-fn.cjs']); // .(c|m)?js

    expect(logger.stderr).toEqual([]);
    expect(logger.stdout).toEqual(jasmine.arrayContaining([
      '[percy] Percy has started!',
      '[percy] Snapshot taken: JS Function Snapshot',
      '[percy] Uploading 1 snapshot...',
      '[percy] Finalized build #1: https://percy.io/test/test/123'
    ]));
  });

  it('snapshots pages from a list of URLs', async () => {
    await snapshot(['./urls.yml', '--base-url=http://localhost:8000']);

    expect(logger.stderr).toEqual([]);
    expect(logger.stdout).toEqual(jasmine.arrayContaining([
      '[percy] Percy has started!',
      '[percy] Snapshot taken: /',
      '[percy] Snapshot taken: /one',
      '[percy] Snapshot taken: /two',
      jasmine.stringMatching('\\[percy\\] Uploading \\d snapshots?'),
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

    await snapshot(['./lengthy.js', '--include=*2', '--exclude=/[13579]/']);

    expect(logger.stderr).toEqual([]);
    expect(logger.stdout).toEqual(jasmine.arrayContaining([
      '[percy] Percy has started!',
      '[percy] Snapshot taken: Snapshot #2',
      '[percy] Snapshot taken: Snapshot #22',
      '[percy] Snapshot taken: Snapshot #42',
      '[percy] Snapshot taken: Snapshot #62',
      '[percy] Snapshot taken: Snapshot #82',
      jasmine.stringMatching('\\[percy\\] Uploading \\d snapshots?'),
      '[percy] Finalized build #1: https://percy.io/test/test/123'
    ]));
  });

  it('does not take snapshots and prints a list with --dry-run', async () => {
    await snapshot(['./pages.yml', '--dry-run']);
    expect(logger.stderr).toEqual(jasmine.arrayContaining([
      '[percy] Build not created'
    ]));
    expect(logger.stdout).toEqual(jasmine.arrayContaining([
      '[percy] Percy has started!',
      '[percy] Snapshot found: YAML Snapshot',
      '[percy] Found 1 snapshot'
    ]));

    logger.reset();

    await snapshot(['./pages.js', '--dry-run']);

    expect(logger.stderr).toEqual(jasmine.arrayContaining([
      '[percy] Build not created'
    ]));
    expect(logger.stdout).toEqual(jasmine.arrayContaining([
      '[percy] Percy has started!',
      '[percy] Snapshot found: JS Snapshot',
      '[percy] Snapshot found: JS Snapshot 2',
      '[percy] Snapshot found: Other JS Snapshot',
      '[percy] Found 3 snapshots'
    ]));
  });

  it('logs validation warnings', async () => {
    fs.writeFileSync('invalid.yml', [
      'snapshots:',
      '  foo: bar'
    ].join('\n'));

    await expectAsync(
      snapshot(['./invalid.yml', '--dry-run'])
    ).toBeRejected();

    expect(logger.stdout).toEqual(jasmine.arrayContaining([
      '[percy] Percy has started!',
      '[percy] Stopping percy...'
    ]));
    expect(logger.stderr).toEqual(jasmine.arrayContaining([
      '[percy] Invalid snapshot options:',
      '[percy] - snapshots: must be an array, received an object',
      '[percy] Build not created',
      '[percy] Error: No snapshots found'
    ]));
  });

  it('allows a top-level references object for .yaml references', async () => {
    fs.writeFileSync('references.yaml', [
      'references:',
      '  ref: &ref Reference Snapshot',
      'snapshots:',
      '  - url: http://localhost:8000/',
      '    name: *ref'
    ].join('\n'));

    await snapshot(['./references.yaml']);

    expect(logger.stderr).toEqual([]);
    expect(logger.stdout).toEqual(jasmine.arrayContaining([
      '[percy] Percy has started!',
      '[percy] Snapshot taken: Reference Snapshot',
      '[percy] Uploading 1 snapshot...',
      '[percy] Finalized build #1: https://percy.io/test/test/123'
    ]));
  });
});
