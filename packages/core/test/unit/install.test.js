import path from 'path';
import * as memfs from 'memfs';
import quibble from 'quibble';
import nock from 'nock';
import logger from '@percy/logger/test/helpers';
import install from '../../src/install';

const CHROMIUM_REVISIONS = install.chromium.revisions;

describe('Unit / Install', () => {
  let install, dlnock, dlcallback, options;

  beforeEach(async () => {
    quibble('fs', memfs.fs);
    memfs.vol.fromJSON({ './': null });
    ({ default: install } = await import('../../src/install'));
    logger.mock();

    // emulate tty properties for testing
    Object.assign(logger.constructor.stdout, {
      isTTY: true,
      columns: 80,
      cursorTo() {},
      clearLine() {}
    });

    // spy on fs methods
    spyOn(memfs.fs.promises, 'mkdir').and.callThrough();
    spyOn(memfs.fs.promises, 'unlink').and.callThrough();
    spyOn(memfs.fs, 'createWriteStream').and.callThrough();
    spyOn(memfs.fs, 'existsSync').and.callThrough();

    // mock a fake download api
    nock.disableNetConnect();
    nock.enableNetConnect('localhost|127.0.0.1');
    dlcallback = jasmine.createSpy('dlcallback')
      .and.callFake(s => [200, s, { 'content-length': s.length }]);
    dlnock = nock('https://fake-download.org').get('/archive.zip')
      .reply(() => dlcallback('archive contents'));

    // all options are required
    options = {
      name: 'Archive',
      revision: 'v0',
      url: 'https://fake-download.org/archive.zip',
      extract: jasmine.createSpy('extract').and.resolveTo(),
      directory: '.downloads',
      executable: 'extracted/bin.exe'
    };
  });

  afterEach(() => {
    memfs.vol.reset();
    quibble.reset();
    nock.cleanAll();
  });

  it('does nothing if the executable already exists in the output directory', async () => {
    memfs.fs.existsSync.and.returnValue(true);
    await install(options);

    expect(memfs.fs.promises.mkdir).not.toHaveBeenCalled();
    expect(memfs.fs.promises.unlink).not.toHaveBeenCalled();
    expect(memfs.fs.createWriteStream).not.toHaveBeenCalled();
    expect(dlnock.isDone()).toBe(false);
  });

  it('creates the output directory when it does not exist', async () => {
    await install(options);

    expect(memfs.fs.promises.mkdir)
      .toHaveBeenCalledOnceWith(path.join('.downloads', 'v0'), { recursive: true });
  });

  it('fetches the archive from the provided url', async () => {
    await install(options);

    expect(dlnock.isDone()).toBe(true);
  });

  it('logs progress during the archive download', async () => {
    let now = Date.now();
    // eta is calculated by the elapsed time and remaining progress
    spyOn(Date, 'now').and.callFake(() => (now += 65002));
    dlcallback.and.callFake(s => [200, s, { 'content-length': s.length * 5 }]);

    await install(options);

    expect(logger.stderr).toEqual([]);
    expect(logger.stdout).toEqual([
      '[percy] Downloading Archive v0...',
      '[percy] Downloading Archive v0 [====                ] 16B/80B 20% 04:20',
      '[percy] Successfully downloaded Archive v0'
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

  it('cleans up the archive after downloading and extracting', async () => {
    memfs.vol.fromJSON({ '.downloads/v0/archive.zip': '' });
    await install(options);

    expect(memfs.vol.existsSync('.downloads/v0/archive.zip')).toBe(false);
  });

  it('handles failed downloads', async () => {
    dlcallback.and.returnValue([404]);

    await expectAsync(install(options))
      .toBeRejectedWithError('Download failed: 404 - https://fake-download.org/archive.zip');
  });

  it('logs the file size in a readable format', async () => {
    let archive = '1'.repeat(20_000_000);

    dlcallback.and.returnValue([200, archive, {
      'content-length': archive.length
    }]);

    await install(options);

    expect(logger.stderr).toEqual([]);
    expect(logger.stdout).toContain(
      '[percy] Downloading Archive v0 [====================] 19.1MB/19.1MB 100% 00:00'
    );
  });

  it('returns the full path of the executable', async () => {
    await expectAsync(install(options))
      .toBeResolvedTo(path.join('.downloads', 'v0', 'extracted', 'bin.exe'));
  });

  describe('Chromium', () => {
    let extractZip;

    beforeEach(() => {
      extractZip = jasmine.createSpy('extract-zip').and.resolveTo();
      quibble('extract-zip', extractZip);

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
        revision: CHROMIUM_REVISIONS.linux,
        url: jasmine.stringMatching(`Linux_x64/${CHROMIUM_REVISIONS.linux}/chrome-linux.zip`),
        return: path.join('chrome-linux', 'chrome'),
        process: { platform: 'linux', arch: 'x64' }
      },
      darwin: {
        revision: CHROMIUM_REVISIONS.darwin,
        url: jasmine.stringMatching(`Mac/${CHROMIUM_REVISIONS.darwin}/chrome-mac.zip`),
        return: path.join('chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'),
        process: { platform: 'darwin', arch: 'x64' }
      },
      darwinArm: {
        revision: CHROMIUM_REVISIONS.darwinArm,
        url: jasmine.stringMatching(`Mac_Arm/${CHROMIUM_REVISIONS.darwinArm}/chrome-mac.zip`),
        return: path.join('chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'),
        process: { platform: 'darwin', arch: 'arm64' }
      },
      win64: {
        revision: CHROMIUM_REVISIONS.win64,
        url: jasmine.stringMatching(`Win_x64/${CHROMIUM_REVISIONS.win64}/chrome-win.zip`),
        return: path.join('chrome-win', 'chrome.exe'),
        process: { platform: 'win32', arch: 'x64' }
      },
      win32: {
        revision: CHROMIUM_REVISIONS.win32,
        url: jasmine.stringMatching(`Win/${CHROMIUM_REVISIONS.win32}/chrome-win.zip`),
        return: path.join('chrome-win', 'chrome.exe'),
        process: { platform: 'win32', arch: 'x32' }
      }
    })) {
      it(`downloads the correct files for ${platform}`, async () => {
        spyOnProperty(process, 'platform').and.returnValue(expected.process.platform);
        spyOnProperty(process, 'arch').and.returnValue(expected.process.arch);

        await expectAsync(install.chromium()).toBeResolvedTo(
          jasmine.stringMatching(expected.return.replace(/[.\\]/g, '\\$&'))
        );

        expect(dlnock.isDone()).toBe(true);
        expect(dlcallback).toHaveBeenCalledOnceWith(expected.url);

        expect(logger.stderr).toEqual([]);
        expect(logger.stdout).toEqual(jasmine.arrayContaining([
          `[percy] Downloading Chromium ${expected.revision}...`,
          `[percy] Successfully downloaded Chromium ${expected.revision}`
        ]));
      });
    }
  });
});
