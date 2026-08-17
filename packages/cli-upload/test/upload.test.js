import { fs, logger, api, setupTest } from '@percy/cli-command/test/helpers';
import upload from '@percy/cli-upload';
import { BYOS_TAG } from '../src/upload.js';

// Real image bytes, kept as buffers rather than strings — the PNG signature
// starts with 0x89, which does not survive a round trip through UTF-8.
const b64 = str => Buffer.from(str, 'base64');

// 1x1 red PNG
const PNG_PIXEL = b64(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ' +
  '/pLvAAAAAElFTkSuQmCC'
);

// 1x1 red JPEG
const JPEG_PIXEL = b64(
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDABALDA4MChAODQ4SERATGCgaGBYWGDEjJR0oOjM9' +
  'PDkzODdASFxOQERXRTc4UG1RV19iZ2hnPk1xeXBkeFxlZ2P/2wBDARESEhgVGC8aGi9jQjhC' +
  'Y2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2P/wAAR' +
  'CAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAA' +
  'AgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkK' +
  'FhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWG' +
  'h4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl' +
  '5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREA' +
  'AgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYk' +
  'NOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOE' +
  'hYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk' +
  '5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDFoooryz7w/9k='
);

// A GIF — readable by the parser, but not a format this command accepts.
const GIF_PIXEL = b64('R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==');

// An ICNS buffer with valid magic bytes and a zero-valued entry length — the
// CVE-2025-71330 proof of concept. `image-size` looped forever on it because a
// zero-length entry never advanced the read offset.
const icnsZeroLengthEntry = () => {
  let buffer = Buffer.alloc(64);
  buffer.write('icns', 0, 'ascii');
  buffer.writeUInt32BE(64, 4); // file length
  buffer.write('ic09', 8, 'ascii'); // first entry type
  buffer.writeUInt32BE(0, 12); // first entry length
  return buffer;
};

describe('percy upload', () => {
  beforeEach(async () => {
    upload.packageInformation = { name: '@percy/cli-upload' };
    process.env.PERCY_TOKEN = 'web_<<PERCY_TOKEN>>';
    process.env.PERCY_CLIENT_ERROR_LOGS = false;
    process.env.PERCY_FORCE_PKG_VALUE = JSON.stringify({ name: '@percy/client', version: '1.0.0' });
    await setupTest({
      filesystem: {
        'images/.keep': '',
        './nope': 'not here'
      }
    });

    // written as buffers rather than through `filesystem` above, which only
    // creates files from strings — and image bytes are not valid UTF-8
    fs.writeFileSync('images/test-1.png', PNG_PIXEL);
    fs.writeFileSync('images/test-2.jpg', JPEG_PIXEL);
    fs.writeFileSync('images/test-3.jpeg', JPEG_PIXEL);
    fs.writeFileSync('images/test-4.gif', GIF_PIXEL);
    fs.unlinkSync('images/.keep');
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
          browsers: null,
          'intelli-story': null,
          'storybook-path': null
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

  it('skips files whose contents are not a readable image', async () => {
    fs.writeFileSync('images/test-5.png', 'this is not a png');
    await upload(['./images']);

    expect(logger.stderr).toEqual([]);
    expect(logger.stdout).toEqual(jasmine.arrayContaining([
      '[percy] Skipping file with unreadable image data: test-5.png',
      '[percy] Uploading 3 snapshots...',
      '[percy] Snapshot uploaded: test-1.png'
    ]));
  });

  // Regression for CVE-2025-71330. The previous `image-size` dependency picked
  // its parser from magic bytes while this command filters on extension, so an
  // ICNS buffer named `.png` reached a parser that looped forever on it. The
  // upload now completes and the crafted file is skipped.
  it('skips a crafted ICNS file named as a png without hanging', async () => {
    fs.writeFileSync('images/crafted.png', icnsZeroLengthEntry());
    await upload(['./images']);

    expect(logger.stderr).toEqual([]);
    expect(logger.stdout).toEqual(jasmine.arrayContaining([
      '[percy] Skipping file with unreadable image data: crafted.png',
      '[percy] Uploading 3 snapshots...',
      '[percy] Finalized build #1: https://percy.io/test/test/123'
    ]));
  });

  // the extension filter passes this through, and the parser reads GIFs happily,
  // so only the format gate keeps it out
  it('skips a readable image whose format is not png or jpeg', async () => {
    fs.writeFileSync('images/gif-named.png', GIF_PIXEL);
    await upload(['./images']);

    expect(logger.stderr).toEqual([]);
    expect(logger.stdout).toEqual(jasmine.arrayContaining([
      '[percy] Skipping file with unreadable image data: gif-named.png',
      '[percy] Uploading 3 snapshots...',
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

    // specify a low concurrency to interrupt the queue later
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

    // Drain announcement is logged on stderr; the legacy
    // AbortError-as-error log no longer fires because the runner now
    // suppresses log.error for signal-driven aborts (err.signal truthy).
    expect(logger.stderr).toEqual(jasmine.arrayContaining([
      jasmine.stringContaining('SIGTERM received, draining'),
      '[percy] Detected error for percy build',
      '[percy] Failure: Snapshot command was not called',
      '[percy] Failure Reason: Snapshot Command was not called. please check your CI for errors',
      '[percy] Suggestion: Try using percy snapshot command to take snapshots',
      '[percy] Refer to the below Doc Links for the same',
      '[percy] * https://www.browserstack.com/docs/percy/take-percy-snapshots/'
    ]));

    // A single SIGTERM is now graceful (force=false), so the legacy
    // "Stopping percy..." log — which fires only on Percy.stop(true) —
    // no longer appears here.
    expect(logger.stdout).toEqual(jasmine.arrayContaining([
      '[percy] Percy has started!',
      '[percy] Uploading 3 snapshots...',
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
