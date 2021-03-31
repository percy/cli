import fs from 'fs';
import path from 'path';
import { Writable } from 'stream';
import nock from 'nock';
import mockRequire from 'mock-require';
import logger from '@percy/logger/test/helpers';
import install from '../../src/install';

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
    Object.assign(logger.constructor.stdout, {
      isTTY: true,
      columns: 80,
      cursorTo() {},
      clearLine() {}
    });

    // stub fs methods
    spyOn(fs.promises, 'mkdir');
    spyOn(fs.promises, 'unlink');
    spyOn(fs, 'existsSync').and.callFake(p => p.endsWith('archive.zip'));
    spyOn(fs, 'createWriteStream').and.returnValue(new MockWritable());

    // mock a fake download api
    nock.disableNetConnect();
    nock.enableNetConnect('localhost|127.0.0.1');
    dlcallback = jasmine.createSpy('dlcallback')
      .and.callFake(s => [200, s, { 'content-length': s.length }]);
    dlnock = nock('https://fake-download.org').get('/archive.zip')
      .reply(() => dlcallback('archive contents'));

    // all options are required
    options = {
      name: 'Test Download',
      revision: 'v0',
      url: 'https://fake-download.org/archive.zip',
      extract: jasmine.createSpy('extract').and.resolveTo(),
      directory: '.downloads',
      executable: 'extracted/bin.exe'
    };
  });

  afterEach(() => {
    nock.cleanAll();
  });

  it('does nothing if the executable already exists in the output directory', async () => {
    fs.existsSync.and.returnValue(true);
    await install(options);

    expect(fs.promises.mkdir).not.toHaveBeenCalled();
    expect(fs.promises.unlink).not.toHaveBeenCalled();
    expect(fs.createWriteStream).not.toHaveBeenCalled();
    expect(dlnock.isDone()).toBe(false);
  });

  it('creates the output directory when it does not exist', async () => {
    await install(options);

    expect(fs.promises.mkdir)
      .toHaveBeenCalledOnceWith(path.join('.downloads', 'v0'), { recursive: true });
  });

  it('fetches the archive from the provided url', async () => {
    await install(options);

    expect(dlnock.isDone()).toBe(true);
  });

  it('logs progress during the archive download', async () => {
    await install(options);

    expect(logger.stderr).toEqual([]);
    expect(logger.stdout).toEqual([
      '[percy] Test Download not found, downloading...',
      '[percy] 16B (v0) [====================] 100% 0.0s', '',
      '[percy] Successfully downloaded Test Download'
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

    expect(options.extract).toHaveBeenCalledOnceWith(
      path.join('.downloads', 'v0', 'archive.zip'),
      path.join('.downloads', 'v0')
    );
  });

  it('handles failed downloads', async () => {
    dlcallback.and.returnValue([404]);

    await expectAsync(install(options))
      .toBeRejectedWithError('Download failed: 404 - https://fake-download.org/archive.zip');

    expect(fs.promises.unlink)
      .toHaveBeenCalledOnceWith(path.join('.downloads', 'v0', 'archive.zip'));
  });

  it('returns the full path of the executable', async () => {
    await expectAsync(install(options))
      .toBeResolvedTo(path.join('.downloads', 'v0', 'extracted', 'bin.exe'));
  });

  describe('Chromium', () => {
    let extractZip;

    beforeEach(() => {
      extractZip = jasmine.createSpy('extract-zip').and.resolveTo();
      mockRequire('extract-zip', extractZip);

      dlnock = nock('https://storage.googleapis.com/chromium-browser-snapshots')
        .persist().get(/.*/).reply(uri => dlcallback(uri));

      // make getters for jasmine property spy
      let { platform, arch } = process;
      Object.defineProperties(process, {
        platform: { get: () => platform },
        arch: { get: () => arch }
      });
    });

    it('downloads from the google storage api', async () => {
      await install.chromium();

      expect(dlnock.isDone()).toBe(true);
    });

    it('extracts to a .local-chromium directory', async () => {
      await install.chromium();

      expect(extractZip).toHaveBeenCalledOnceWith(jasmine.any(String), {
        dir: jasmine.stringMatching('(/|\\\\).local-chromium(/|\\\\)')
      });
    });

    for (let [platform, expected] of Object.entries({
      linux: {
        revision: install.chromeRevisions.linux,
        url: jasmine.stringMatching(`Linux_x64/${install.chromeRevisions.linux}/chrome-linux.zip`),
        return: path.join('chrome-linux', 'chrome')
      },
      darwin: {
        revision: install.chromeRevisions.darwin,
        url: jasmine.stringMatching(`Mac/${install.chromeRevisions.darwin}/chrome-mac.zip`),
        return: path.join('chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium')
      },
      win64: {
        revision: install.chromeRevisions.win64,
        url: jasmine.stringMatching(`Win_x64/${install.chromeRevisions.win64}/chrome-win.zip`),
        return: path.join('chrome-win', 'chrome.exe')
      },
      win32: {
        revision: install.chromeRevisions.win32,
        url: jasmine.stringMatching(`Win/${install.chromeRevisions.win32}/chrome-win32.zip`),
        return: path.join('chrome-win32', 'chrome.exe')
      }
    })) {
      it(`downloads the correct files for ${platform}`, async () => {
        spyOnProperty(process, 'platform').and.returnValue(platform === 'win64' ? 'win32' : platform);
        spyOnProperty(process, 'arch').and.returnValue(platform === 'win32' ? 'x32' : 'x64');

        await expectAsync(install.chromium()).toBeResolvedTo(
          jasmine.stringMatching(expected.return.replace(/[.\\]/g, '\\$&'))
        );

        expect(dlnock.isDone()).toBe(true);
        expect(dlcallback).toHaveBeenCalledOnceWith(expected.url);

        expect(logger.stderr).toEqual([]);
        expect(logger.stdout).toEqual([
          '[percy] Chromium not found, downloading...',
          jasmine.stringMatching(`(${expected.revision})`), '',
          '[percy] Successfully downloaded Chromium'
        ]);
      });
    }
  });
});
