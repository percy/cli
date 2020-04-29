import expect from 'expect';
import mock from 'mock-require';
import { stdio } from './helpers';

// mock browser fetcher
const mockFetcher = {
  revisionInfo(revision) {
    this.revisionInfo.calls.push([revision]);
    return { revision, ...this.revisionInfo.return };
  },
  download(revision) {
    this.download.calls.push([revision]);
  },
  reset() {
    this.revisionInfo.calls = [];
    this.revisionInfo.return = {};
    this.download.calls = [];
  }
};

// require the install script after mocking fs and puppeteer
mock('fs', { existsSync: path => path !== '404' });
mock('puppeteer-core', { createBrowserFetcher: () => mockFetcher });
const maybeInstallBrowser = mock.reRequire('../src/utils/install-browser').default;

describe('Browser Install', () => {
  beforeEach(() => {
    mockFetcher.reset();
  });

  afterEach(() => {
    delete process.env.PUPPETEER_EXECUTABLE_PATH;
  });

  after(() => {
    mock.stopAll();
  });

  it('returns the provided executable path if already installed', async () => {
    await expect(stdio.capture(() => maybeInstallBrowser('bin-exe'))).resolves.toBe('bin-exe');
    expect(mockFetcher.revisionInfo.calls).toHaveLength(0);
    expect(mockFetcher.download.calls).toHaveLength(0);
  });

  it('logs an error and downloads a browser if the provided executable path is not found', async () => {
    mockFetcher.revisionInfo.return.executablePath = 'bin-exe';
    await expect(stdio.capture(() => maybeInstallBrowser('404'))).resolves.toBe('bin-exe');
    expect(stdio[2]).toEqual(['[percy] Puppeteer executable path not found: 404\n']);
    expect(mockFetcher.download.calls).toHaveLength(1);
  });

  it('uses an environment variable as the default executable path', async () => {
    process.env.PUPPETEER_EXECUTABLE_PATH = 'env-bin-exe';
    await expect(stdio.capture(() => maybeInstallBrowser())).resolves.toBe('env-bin-exe');
    expect(mockFetcher.revisionInfo.calls).toHaveLength(0);
    expect(mockFetcher.download.calls).toHaveLength(0);
  });

  it('checks if the default browser revision is already installed', async () => {
    let rev = require('puppeteer-core/package.json').puppeteer.chromium_revision;
    mockFetcher.revisionInfo.return = { local: true, executablePath: 'bin-exe' };
    await expect(stdio.capture(() => maybeInstallBrowser())).resolves.toBe('bin-exe');
    expect(mockFetcher.revisionInfo.calls[0][0]).toEqual(rev);
    expect(mockFetcher.download.calls).toHaveLength(0);
  });
});
