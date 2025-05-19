import { fs, logger, api, setupTest } from '@percy/cli-command/test/helpers';
import upload from '@percy/cli-upload';
import { BYOS_TAG } from '../src/upload.js';

// http://png-pixel.com/
const pixel = Buffer.from((
  'R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw=='
), 'base64').toString();

describe('percy upload', () => {
  beforeEach(async () => {
    upload.packageInformation = { name: '@percy/cli-upload' };
    process.env.PERCY_TOKEN = 'web_<<PERCY_TOKEN>>';
    process.env.PERCY_CLIENT_ERROR_LOGS = false;
    process.env.PERCY_FORCE_PKG_VALUE = JSON.stringify({ name: '@percy/client', version: '1.0.0' });
    await setupTest({
      filesystem: {
        'images/test-1.png': pixel,
        'images/test-2.jpg': pixel,
        'images/test-3.jpeg': pixel,
        'images/test-4.gif': pixel,
        './nope': 'not here'
      }
    });
  });

  afterEach(() => {
    delete process.env.PERCY_TOKEN;
    delete process.env.PERCY_ENABLE;
    delete process.env.PERCY_CLIENT_ERROR_LOGS;
    delete upload.packageInformation;
  });

  it('skips uploading when percy is disabled', async () => {
    process.env.PERCY_ENABLE = '0';
    await upload(['./images']);

    expect(logger.stdout).toEqual([]);
    expect(logger.stderr).toEqual(['[percy] Percy is disabled']);
  });

  it('errors when the directory is not found', async () => {
    await expectAsync(upload(['./404'])).toBeRejected();

    expect(logger.stdout).toEqual([]);
    expect(logger.stderr).toEqual([
      '[percy] Error: Not found: ./404'
    ]);
  });

  it('errors when the path is not a directory', async () => {
    await expectAsync(upload(['./nope'])).toBeRejected();

    expect(logger.stdout).toEqual([]);
    expect(logger.stderr).toEqual([
      '[percy] Error: Not a directory: ./nope'
    ]);
  });

  it('errors when there are no matching files', async () => {
    await expectAsync(
      upload(['./images', '--files=no-match.png'])
    ).toBeRejected();

    expect(logger.stdout).toEqual([]);
    expect(logger.stderr).toEqual([
      '[percy] Error: No matching files found in \'./images\''
    ]);
  });

  it('creates a new build and uploads snapshots with web token', async () => {
    await upload(['./images']);

    expect(logger.stderr).toEqual([]);
    expect(logger.stdout).toEqual(jasmine.arrayContaining([
      '[percy] Percy has started!',
      '[percy] Uploading 3 snapshots...',
      '[percy] Snapshot uploaded: test-1.png',
      '[percy] Snapshot uploaded: test-2.jpg',
      '[percy] Snapshot uploaded: test-3.jpeg',
      '[percy] Finalized build #1: https://percy.io/test/test/123'
    ]));

    expect(api.requests['/builds/123/snapshots'][0].body).toEqual({
      data: {
        type: 'snapshots',
        attributes: {
          name: 'test-1.png',
          widths: [10],
          scope: null,
          sync: false,
          'test-case': null,
          tags: [],
          'scope-options': {},
          'minimum-height': 10,
          'enable-javascript': null,
          regions: null,
          'enable-layout': false,
          'th-test-case-execution-id': null,
          browsers: null
        },
        relationships: {
          resources: {
            data: jasmine.arrayContaining([{
              type: 'resources',
              id: jasmine.any(String),
              attributes: {
                'resource-url': 'http://local/test-1',
                mimetype: 'text/html',
                'for-widths': null,
                'is-root': true
              }
            }, {
              type: 'resources',
              id: jasmine.any(String),
              attributes: {
                'resource-url': 'http://local/test-1.png',
                mimetype: 'image/png',
                'for-widths': null,
                'is-root': null
              }
            }])
          }
        }
      }
    });
  });

  it('strips file extensions with `--strip-extensions`', async () => {
    await upload(['./images', '--strip-extensions']);

    expect(logger.stderr).toEqual([]);
    expect(logger.stdout).toEqual(jasmine.arrayContaining([
      '[percy] Percy has started!',
      '[percy] Uploading 3 snapshots...',
      '[percy] Snapshot uploaded: test-1',
      '[percy] Snapshot uploaded: test-2',
      '[percy] Snapshot uploaded: test-3',
      '[percy] Finalized build #1: https://percy.io/test/test/123'
    ]));
  });

  it('skips unsupported image types', async () => {
    await upload(['./images', '--files=*']);

    expect(logger.stderr).toEqual([]);
    expect(logger.stdout).toEqual(jasmine.arrayContaining([
      '[percy] Percy has started!',
      '[percy] Skipping unsupported file type: test-4.gif',
      '[percy] Uploading 3 snapshots...',
      '[percy] Snapshot uploaded: test-1.png',
      '[percy] Snapshot uploaded: test-2.jpg',
      '[percy] Snapshot uploaded: test-3.jpeg',
      '[percy] Finalized build #1: https://percy.io/test/test/123'
    ]));
  });

  it('does not upload snapshots and prints matching files with --dry-run', async () => {
    await upload(['./images', '--dry-run']);

    expect(logger.stderr).toEqual(jasmine.arrayContaining([
      '[percy] Build not created'
    ]));
    expect(logger.stdout).toEqual(jasmine.arrayContaining([
      '[percy] Found 3 snapshots',
      '[percy] Snapshot found: test-1.png',
      '[percy] Snapshot found: test-2.jpg',
      '[percy] Snapshot found: test-3.jpeg'
    ]));

    logger.reset();
    await upload(['./images', '--dry-run', '--files=test-1.png']);

    expect(logger.stderr).toEqual(jasmine.arrayContaining([
      '[percy] Build not created'
    ]));
    expect(logger.stdout).toEqual(jasmine.arrayContaining([
      '[percy] Found 1 snapshot',
      '[percy] Snapshot found: test-1.png'
    ]));
  });

  it('stops uploads on process termination', async () => {
    await api.mock({ delay: 100 });

    // specify a low concurrency to interupt the queue later
    fs.writeFileSync('.percy.yml', [
      'version: 2',
      'upload:',
      '  concurrency: 1'
    ].join('\n'));

    let up = upload(['./images']);

    // wait for the first upload before terminating
    await new Promise(resolve => (function check() {
      let done = !!api.requests['/builds/123/snapshots'];
      setTimeout(done ? resolve : check, 10);
    }()));

    process.emit('SIGTERM');
    await up;

    expect(logger.stderr).toEqual([
      '[percy] AbortError: SIGTERM',
      '[percy] Detected error for percy build',
      '[percy] Failure: Snapshot command was not called',
      '[percy] Failure Reason: Snapshot Command was not called. please check your CI for errors',
      '[percy] Suggestion: Try using percy snapshot command to take snapshots',
      '[percy] Refer to the below Doc Links for the same',
      '[percy] * https://www.browserstack.com/docs/percy/take-percy-snapshots/'
    ]);

    expect(logger.stdout).toEqual(jasmine.arrayContaining([
      '[percy] Percy has started!',
      '[percy] Uploading 3 snapshots...',
      '[percy] Stopping percy...',
      '[percy] Snapshot uploaded: test-1.png',
      '[percy] Finalized build #1: https://percy.io/test/test/123'
    ]));
  });

  it('creates a new build and upload snapshots with ss token', async () => {
    process.env.PERCY_TOKEN = 'ss_<<PERCY_TOKEN>>';
    await upload(['./images']);

    expect(logger.stderr).toEqual([]);
    expect(logger.stdout).toEqual(jasmine.arrayContaining([
      '[percy] Percy has started!',
      '[percy] Uploading 3 snapshots...',
      '[percy] Snapshot uploaded: test-1.png',
      '[percy] Snapshot uploaded: test-2.jpg',
      '[percy] Snapshot uploaded: test-3.jpeg',
      '[percy] Finalized build #1: https://percy.io/test/test/123'
    ]));

    expect(api.requests['/snapshots/4567/comparisons'][0].body).toEqual({
      data: {
        type: 'comparisons',
        attributes: jasmine.objectContaining({
          'external-debug-url': null,
          'ignore-elements-data': null,
          sync: false
        }),
        relationships: {
          tag: {
            data: {
              type: 'tag',
              attributes: jasmine.objectContaining(BYOS_TAG)
            }
          },
          tiles: {
            data: jasmine.arrayContaining([{
              type: 'tiles',
              attributes: jasmine.objectContaining({
                sha: jasmine.any(String)
              })
            }])
          }
        }
      }
    });
  });

  it('throws error for token type other than web and generic', async () => {
    process.env.PERCY_TOKEN = 'app_invalid_token';
    await expectAsync(upload(['./images'])).toBeRejected();
    expect(logger.stderr).toEqual(jasmine.arrayContaining([
      '[percy] Error: Invalid Token Type. Only "web" and "self-managed" token types are allowed.'
    ]));
  });
});
