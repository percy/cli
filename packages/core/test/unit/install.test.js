import fs from 'fs';
import path from 'path';
import { Writable } from 'stream';
import nock from 'nock';
import mockRequire from 'mock-require';
import logger from '@percy/logger';
import install from '../../src/install';

// mock & stub helpers
function mock(fn) {
  return function mocked(...args) {
    (mocked.calls ||= []).push(args);
    return fn(...args);
  };
}

function stub(obj, prop, fn) {
  let og = Object.getOwnPropertyDescriptor(obj, prop);
  let descr = 'value';

  if (typeof fn !== 'function') {
    let value = fn;
    fn = () => value;
    descr = 'get';
  }

  let mocked = Object.assign(mock(fn), {
    restore: () => og.value?.restore?.() ??
      Object.defineProperty(obj, prop, og)
  });

  Object.defineProperty(obj, prop, { [descr]: mocked });
  stub.all.add(mocked);
  return mocked;
}

stub.all = new Set();
stub.restoreAll = () => {
  for (let s of stub.all) s.restore();
  stub.all.clear();
};

// mock writable stream
class MockWritable extends Writable {
  _write(chunk, encoding, callback) {
    callback();
  }
}

describe('Unit / Install', () => {
  let dlnock, dlcallback, options;

  beforeEach(() => {
    // emulate tty properties for testing
    Object.assign(logger.instance.stdout, {
      isTTY: true,
      columns: 80,
      cursorTo() {},
      clearLine() {}
    });

    // stub fs methods
    stub(fs.promises, 'mkdir', async () => {});
    stub(fs.promises, 'unlink', async () => {});
    stub(fs, 'existsSync', p => p.endsWith('archive.zip'));
    stub(fs, 'createWriteStream', () => new MockWritable());

    // mock a fake download api
    nock.disableNetConnect();
    nock.enableNetConnect('localhost|127.0.0.1');
    dlcallback = mock(s => [200, s, { 'content-length': s.length }]);
    dlnock = nock('https://fake-download.org').get('/archive.zip')
      .reply(() => dlcallback('archive contents'));

    // all options are required
    options = {
      name: 'Test Download',
      revision: 'v0',
      url: 'https://fake-download.org/archive.zip',
      extract: mock(async () => {}),
      directory: '.downloads',
      executable: 'extracted/bin.exe'
    };
  });

  afterEach(() => {
    stub.restoreAll();
    nock.cleanAll();
  });

  it('does nothing if the executable already exists in the output directory', async () => {
    stub(fs, 'existsSync', () => true);
    await install(options);

    expect(fs.promises.mkdir.calls).toBeUndefined();
    expect(fs.promises.unlink.calls).toBeUndefined();
    expect(fs.createWriteStream.calls).toBeUndefined();
    expect(dlnock.isDone()).toBe(false);
  });

  it('creates the output directory when it does not exist', async () => {
    await install(options);

    expect(fs.promises.mkdir.calls[0])
      .toEqual([path.join('.downloads', 'v0'), { recursive: true }]);
  });

  it('fetches the archive from the provided url', async () => {
    await install(options);

    expect(dlnock.isDone()).toBe(true);
  });

  it('logs progress during the archive download', async () => {
    await install(options);

    expect(logger.stderr).toEqual([]);
    expect(logger.stdout).toEqual([
      '[percy] Test Download not found, downloading...\n',
      '[percy] 16B (v0) [====================] 100% 0.0s', '\n',
      '[percy] Successfully downloaded Test Download\n'
    ]);
  });

  it('does not log progress when info logs are disabled', async () => {
    logger.loglevel('error');

    await install(options);

    expect(logger.stderr).toEqual([]);
    expect(logger.stdout).toEqual([]);
  });

  it('extracts the downloaded archive to the output directory', async () => {
    await install(options);

    expect(options.extract.calls[0]).toEqual([
      path.join('.downloads', 'v0', 'archive.zip'),
      path.join('.downloads', 'v0')
    ]);
  });

  it('handles failed downloads', async () => {
    dlcallback = () => [404];

    await expectAsync(install(options)).toBeRejectedWithError('Download failed: 404 - https://fake-download.org/archive.zip');

    expect(fs.promises.unlink.calls[0])
      .toEqual([path.join('.downloads', 'v0', 'archive.zip')]);
  });

  it('returns the full path of the executable', async () => {
    await expectAsync(install(options))
      .toBeResolvedTo(path.join('.downloads', 'v0', 'extracted', 'bin.exe'));
  });

  describe('Chromium', () => {
    let extract;

    beforeEach(() => {
      extract = mock(async () => {});
      mockRequire('extract-zip', extract);
      dlnock = nock('https://storage.googleapis.com/chromium-browser-snapshots')
        .persist().get(/.*/).reply(uri => dlcallback(uri));
    });

    it('downloads from the google storage api', async () => {
      await install.chromium();

      expect(dlnock.isDone()).toBe(true);
    });

    it('extracts to a .local-chromium directory', async () => {
      await install.chromium();

      expect(extract.calls[0]).toEqual([jasmine.any(String), {
        dir: jasmine.stringMatching('(/|\\\\).local-chromium(/|\\\\)')
      }]);
    });

    for (let [platform, expected] of Object.entries({
      linux: {
        revision: '812847',
        url: jasmine.stringMatching('Linux_x64/812847/chrome-linux.zip'),
        return: path.join('chrome-linux', 'chrome')
      },
      darwin: {
        revision: '812851',
        url: jasmine.stringMatching('Mac/812851/chrome-mac.zip'),
        return: path.join('chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium')
      },
      win64: {
        revision: '812845',
        url: jasmine.stringMatching('Win_x64/812845/chrome-win.zip'),
        return: path.join('chrome-win', 'chrome.exe')
      },
      win32: {
        revision: '812822',
        url: jasmine.stringMatching('Win/812822/chrome-win32.zip'),
        return: path.join('chrome-win32', 'chrome.exe')
      }
    })) {
      it(`downloads the correct files for ${platform}`, async () => {
        stub(process, 'platform', platform === 'win64' ? 'win32' : platform);
        stub(process, 'arch', platform === 'win32' ? 'x32' : 'x64');

        await expectAsync(install.chromium()).toBeResolvedTo(
          jasmine.stringMatching(expected.return.replace(/[.\\]/g, '\\$&'))
        );

        expect(dlnock.isDone()).toBe(true);
        expect(dlcallback.calls[0]).toEqual([expected.url]);

        expect(logger.stderr).toEqual([]);
        expect(logger.stdout).toEqual([
          '[percy] Chromium not found, downloading...\n',
          jasmine.stringMatching(`(${expected.revision})`), '\n',
          '[percy] Successfully downloaded Chromium\n'
        ]);
      });
    }
  });
});
