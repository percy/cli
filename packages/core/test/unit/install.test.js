import path from 'path';
import logger from '@percy/logger/test/helpers';
import { mockfs, fs } from '@percy/config/test/helpers';
import { mockRequests } from '@percy/client/test/helpers';
import install from '../../src/install.js';

const CHROMIUM_REVISIONS = install.chromium.revisions;

describe('Unit / Install', () => {
  let dl, options;

  beforeEach(async () => {
    await logger.mock({ isTTY: true });
    await mockfs();

    // mock a fake download api
    dl = await mockRequests('https://fake-download.org/archive.zip');

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

  it('does nothing if the executable already exists in the output directory', async () => {
    fs.existsSync.and.returnValue(true);
    await install.download(options);

    expect(fs.promises.mkdir).not.toHaveBeenCalled();
    expect(fs.promises.unlink).not.toHaveBeenCalled();
    expect(fs.createWriteStream).not.toHaveBeenCalled();
    expect(dl).not.toHaveBeenCalled();
  });

  it('creates the output directory when it does not exist', async () => {
    await install.download(options);

    expect(fs.promises.mkdir).toHaveBeenCalledOnceWith(
      path.join('.downloads', 'v0'), { recursive: true });
  });

  it('fetches the archive from the provided url', async () => {
    await install.download(options);

    expect(dl).toHaveBeenCalled();
  });

  it('logs progress during the archive download', async () => {
    let now = Date.now();
    // eta is calculated by the elapsed time and remaining progress
    spyOn(Date, 'now').and.callFake(() => (now += 65000));
    dl.and.returnValue([200, 'partial contents', { 'content-length': 80 }]);

    await install.download(options);

    expect(logger.stderr).toEqual([]);
    expect(logger.stdout).toEqual([
      '[percy] Downloading Archive v0...',
      '[percy] Downloading Archive v0 [====                ] 16B/80B 20% 04:20',
      '[percy] Successfully downloaded Archive v0'
    ]);
  });

  it('does not log progress when info logs are disabled', async () => {
    logger.loglevel('error');

    await install.download(options);

    expect(logger.stderr).toEqual([]);
    expect(logger.stdout).toEqual([]);
  });

  it('extracts the downloaded archive to the output directory', async () => {
    await install.download(options);

    expect(options.extract).toHaveBeenCalledOnceWith(
      path.join('.downloads', 'v0', 'archive.zip'),
      path.join('.downloads', 'v0')
    );
  });

  it('cleans up the archive after downloading and extracting', async () => {
    fs.$vol.fromJSON({ '.downloads/v0/archive.zip': '' });
    expect(fs.existsSync('.downloads/v0/archive.zip')).toBe(true);

    await install.download(options);

    expect(fs.existsSync('.downloads/v0/archive.zip')).toBe(false);
  });

  it('handles failed downloads', async () => {
    dl.and.returnValue([404]);

    await expectAsync(install.download(options))
      .toBeRejectedWithError('Download failed: 404 - https://fake-download.org/archive.zip');
  });

  it('logs the file size in a readable format', async () => {
    dl.and.returnValue([200, '1'.repeat(20_000_000)]);

    await install.download(options);

    expect(logger.stderr).toEqual([]);
    expect(logger.stdout).toContain(
      '[percy] Downloading Archive v0 [====================] 19.1MB/19.1MB 100% 00:00'
    );
  });

  it('returns the full path of the executable', async () => {
    await expectAsync(install.download(options)).toBeResolvedTo(
      path.join('.downloads', 'v0', 'extracted', 'bin.exe'));
  });

  describe('Chromium', () => {
    let extractZip;

    beforeEach(async () => {
      dl = await mockRequests('https://storage.googleapis.com');

      // stub extract-zip using esm loader mocks
      extractZip = jasmine.createSpy('exports').and.resolveTo();
      global.__MOCK_IMPORTS__.set('extract-zip', { default: extractZip });

      // make getters for jasmine property spy
      let { platform, arch } = process;
      Object.defineProperties(process, {
        platform: { get: () => platform },
        arch: { get: () => arch }
      });
    });

    it('downloads from the google storage api', async () => {
      await install.chromium();

      expect(dl).toHaveBeenCalled();
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

        expect(dl).toHaveBeenCalledOnceWith(
          jasmine.objectContaining({ url: expected.url }));

        expect(logger.stderr).toEqual([]);
        expect(logger.stdout).toEqual(jasmine.arrayContaining([
          `[percy] Downloading Chromium ${expected.revision}...`,
          `[percy] Successfully downloaded Chromium ${expected.revision}`
        ]));
      });
    }
  });
});
