import { logger, mockRequests, mockfs, fs } from '@percy/cli-command/test/helpers';
import { mockUpdateCache } from './helpers.js';
import { checkForUpdate } from '../src/update.js';

describe('CLI update check', () => {
  let ghAPI;

  beforeEach(async () => {
    let pkg = { name: '@percy/cli', version: '1.0.0' };
    await mockfs({ './package.json': JSON.stringify(pkg) });
    ghAPI = await mockRequests('https://api.github.com');
    await logger.mock();
  });

  it('fetches and caches the latest release information', async () => {
    ghAPI.and.returnValue([200, [{ tag_name: 'v1.0.0' }]]);

    expect(fs.existsSync('.releases')).toBe(false);

    await checkForUpdate();
    expect(logger.stdout).toEqual([]);
    expect(logger.stderr).toEqual([]);
    expect(ghAPI).toHaveBeenCalled();

    expect(fs.existsSync('.releases')).toBe(true);
    expect(JSON.parse(fs.readFileSync('.releases')))
      .toHaveProperty('data', [{ tag: 'v1.0.0' }]);
  });

  it('does not fetch the latest release information if cached', async () => {
    ghAPI.and.returnValue([200, [{ tag_name: 'v1.0.0' }]]);
    mockUpdateCache([{ tag: 'v1.0.0' }]);

    await checkForUpdate();
    expect(logger.stdout).toEqual([]);
    expect(logger.stderr).toEqual([]);
    expect(ghAPI).not.toHaveBeenCalled();
  });

  it('does not fetch the latest release information if PERCY_SKIP_UPDATE_CHECK is present', async () => {
    expect(fs.existsSync('.releases')).toBe(false);
    process.env.PERCY_SKIP_UPDATE_CHECK = 1;

    logger.loglevel('debug');

    await checkForUpdate();
    expect(logger.stdout).toEqual([]);
    expect(logger.stderr).toEqual(['[percy:cli:update] Skipping update check']);
    expect(ghAPI).not.toHaveBeenCalled();

    delete process.env.PERCY_SKIP_UPDATE_CHECK;
  });

  it('fetchs the latest release information if the cache is outdated', async () => {
    ghAPI.and.returnValue([200, [{ tag_name: 'v1.0.0' }]]);

    let cacheCreatedAt = Date.now() - (30 * 24 * 60 * 60 * 1000);
    mockUpdateCache([{ tag: 'v0.2.0' }, { tag: 'v0.1.0' }], cacheCreatedAt);

    await checkForUpdate();
    expect(logger.stdout).toEqual([]);
    expect(logger.stderr).toEqual([]);
    expect(ghAPI).toHaveBeenCalled();

    expect(JSON.parse(fs.readFileSync('.releases')))
      .toHaveProperty('data', [{ tag: 'v1.0.0' }]);
  });

  it('warns when a new version is available', async () => {
    mockUpdateCache([{ tag: 'v1.1.0' }, { tag: 'v1.0.0' }]);

    await checkForUpdate();
    expect(logger.stdout).toEqual([]);
    expect(logger.stderr).toEqual([
      '\n[percy] A new version of @percy/cli is available! 1.0.0 -> 1.1.0\n'
    ]);
  });

  it('does not warns when a new pre release is available', async () => {
    mockUpdateCache([{ tag: 'v1.1.0', prerelease: true }, { tag: 'v1.0.0' }]);

    await checkForUpdate();
    expect(logger.stdout).toEqual([]);
    expect(logger.stderr).toEqual([]);
  });

  it('warns when the current version is outdated', async () => {
    mockUpdateCache([{ tag: 'v2.0.2', prerelease: true }, { tag: 'v2.0.1', prerelease: false }, { tag: 'v2.0.0', prerelease: true }]);

    await checkForUpdate();
    expect(logger.stdout).toEqual([]);
    expect(logger.stderr).toEqual([
      '\n[percy] Heads up! The current version of @percy/cli ' +
        'is more than 10 releases behind! 1.0.0 -> 2.0.1\n'
    ]);
  });

  it('handles errors reading from cache and logs debug info', async () => {
    let cachefile = mockUpdateCache([{ tag: 'v1.0.0' }]);
    fs.readFileSync.withArgs(cachefile).and.throwError(new Error('EACCES'));
    ghAPI.and.returnValue([200, [{ tag_name: 'v1.0.0' }]]);

    await checkForUpdate();
    expect(logger.stdout).toEqual([]);
    expect(logger.stderr).toEqual([]);

    logger.loglevel('debug');

    await checkForUpdate();
    expect(logger.stdout).toEqual([]);
    expect(logger.stderr).toEqual([
      '[percy:cli:update:cache] Unable to read from cache',
      jasmine.stringContaining('[percy:cli:update:cache] Error: EACCES')
    ]);

    expect(ghAPI).toHaveBeenCalled();
  });

  it('handles errors writing to cache and logs debug info', async () => {
    fs.writeFileSync.and.throwError(new Error('EACCES'));
    ghAPI.and.returnValue([200, [{ tag_name: 'v1.0.0' }]]);

    await checkForUpdate();
    expect(logger.stdout).toEqual([]);
    expect(logger.stderr).toEqual([]);

    logger.loglevel('debug');

    await checkForUpdate();
    expect(logger.stdout).toEqual([]);
    expect(logger.stderr).toEqual([
      '[percy:cli:update:cache] Unable to write to cache',
      jasmine.stringContaining('[percy:cli:update:cache] Error: EACCES')
    ]);

    expect(ghAPI).toHaveBeenCalled();
    expect(fs.existsSync('.releases')).toBe(false);
  });

  it('handles request errors and logs debug info', async () => {
    ghAPI.and.returnValue([503]);

    await checkForUpdate();
    expect(logger.stdout).toEqual([]);
    expect(logger.stderr).toEqual([]);

    logger.loglevel('debug');

    await checkForUpdate();
    expect(logger.stdout).toEqual([]);
    expect(logger.stderr).toEqual(jasmine.arrayContaining([
      '[percy:cli:update] Unable to check for updates',
      jasmine.stringContaining('[percy:cli:update] Error: 503')
    ]));
  });
});
