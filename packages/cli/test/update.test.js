import { logger, mockRequests, mockfs, fs } from '@percy/cli-command/test/helpers';
import { mockUpdateCache } from './helpers.js';
import { checkForUpdate } from '../src/update.js';

describe('CLI update check', () => {
  let ghAPI;

  // remocks package.json to simulate running a different version of the CLI. this resets the
  // mocked filesystem, so it must be called before mocking the update cache
  async function mockVersion(version) {
    await mockfs({ './package.json': JSON.stringify({ name: '@percy/cli', version }) });
  }

  beforeEach(async () => {
    await mockVersion('1.0.0');
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

  it('warns with the exact number of releases behind when far behind', async () => {
    await mockVersion('1.0.0');
    // 12 stable releases newer than 1.0.0, with 1.0.0 itself inside the fetched window
    mockUpdateCache([
      ...Array.from({ length: 12 }, (_, i) => ({ tag: `v1.0.${12 - i}` })),
      { tag: 'v1.0.0' }
    ]);

    await checkForUpdate();
    expect(logger.stdout).toEqual([]);
    expect(logger.stderr).toEqual([
      '\n[percy] Heads up! Your @percy/cli is 12 releases behind the latest release. ' +
        '1.0.0 -> 1.0.12\nSee https://github.com/percy/cli/releases for what changed.\n'
    ]);
  });

  it('escalates the warning when a major version behind, even by one release', async () => {
    await mockVersion('1.0.0');
    mockUpdateCache([{ tag: 'v2.0.0' }, { tag: 'v1.0.0' }]);

    await checkForUpdate();
    expect(logger.stdout).toEqual([]);
    expect(logger.stderr).toEqual([
      '\n[percy] Heads up! Your @percy/cli is 1 release behind the latest release. ' +
        '1.0.0 -> 2.0.0\nSee https://github.com/percy/cli/releases for what changed.\n'
    ]);
  });

  it('warns without a count when the current version predates every fetched release', async () => {
    await mockVersion('1.0.0');
    mockUpdateCache([{ tag: 'v2.0.2', prerelease: true }, { tag: 'v2.0.1', prerelease: false }, { tag: 'v2.0.0', prerelease: true }]);

    await checkForUpdate();
    expect(logger.stdout).toEqual([]);
    expect(logger.stderr).toEqual([
      '\n[percy] Heads up! Your @percy/cli is significantly out of date. 1.0.0 -> 2.0.1\n' +
        'See https://github.com/percy/cli/releases for what changed.\n'
    ]);
  });

  it('warns that a pre-release is in use rather than counting releases behind', async () => {
    await mockVersion('1.1.0-beta.3');
    mockUpdateCache([
      { tag: 'v1.1.0' },
      { tag: 'v1.1.0-beta.3', prerelease: true },
      { tag: 'v1.0.0' }
    ]);

    await checkForUpdate();
    expect(logger.stdout).toEqual([]);
    expect(logger.stderr).toEqual([
      '\n[percy] You are using a pre-release build of @percy/cli. ' +
        '1.1.0-beta.3 -> 1.1.0 (latest stable)\n'
    ]);
  });

  it('does not warn when a pre-release is ahead of the latest stable release', async () => {
    await mockVersion('1.2.0-beta.0');
    mockUpdateCache([{ tag: 'v1.1.0' }, { tag: 'v1.0.0' }]);

    await checkForUpdate();
    expect(logger.stdout).toEqual([]);
    expect(logger.stderr).toEqual([]);
  });

  it('does not warn when the current version is ahead of the latest release', async () => {
    await mockVersion('1.2.0');
    mockUpdateCache([{ tag: 'v1.1.0' }, { tag: 'v1.0.0' }]);

    await checkForUpdate();
    expect(logger.stdout).toEqual([]);
    expect(logger.stderr).toEqual([]);
  });

  it('compares releases by version rather than by the order they were published', async () => {
    await mockVersion('1.1.0');
    // a backported patch published after the newest release
    mockUpdateCache([{ tag: 'v1.0.1' }, { tag: 'v1.2.0' }, { tag: 'v1.1.0' }]);

    await checkForUpdate();
    expect(logger.stdout).toEqual([]);
    expect(logger.stderr).toEqual([
      '\n[percy] A new version of @percy/cli is available! 1.1.0 -> 1.2.0\n'
    ]);
  });

  it('handles release tags that are not prefixed with a v', async () => {
    await mockVersion('1.0.0');
    mockUpdateCache([{ tag: '1.1.0' }, { tag: '1.0.0' }]);

    await checkForUpdate();
    expect(logger.stdout).toEqual([]);
    expect(logger.stderr).toEqual([
      '\n[percy] A new version of @percy/cli is available! 1.0.0 -> 1.1.0\n'
    ]);
  });

  it('ignores releases whose tags are prereleases regardless of the release flag', async () => {
    await mockVersion('1.0.0');
    // the prerelease flag is set by hand when publishing and is sometimes wrong
    mockUpdateCache([{ tag: 'v1.1.0-beta.1', prerelease: false }, { tag: 'v1.0.0' }]);

    await checkForUpdate();
    expect(logger.stdout).toEqual([]);
    expect(logger.stderr).toEqual([]);
  });

  it('does not warn when no stable releases are found', async () => {
    logger.loglevel('debug');
    mockUpdateCache([{ tag: 'v1.1.0', prerelease: true }]);

    await checkForUpdate();
    expect(logger.stdout).toEqual([]);
    expect(logger.stderr).toEqual([
      '[percy:cli:update] No stable releases found to compare against'
    ]);
  });

  it('does not warn when the current version cannot be parsed', async () => {
    await mockVersion('not-a-version');
    mockUpdateCache([{ tag: 'v1.1.0' }]);
    logger.loglevel('debug');

    await checkForUpdate();
    expect(logger.stdout).toEqual([]);
    expect(logger.stderr).toEqual([
      '[percy:cli:update] Unable to parse the current version: not-a-version'
    ]);
  });

  it('ignores release tags that cannot be parsed', async () => {
    await mockVersion('1.0.0');
    mockUpdateCache([{ tag: 'nightly' }, { tag: 'v1.1.0' }, { tag: 'v1.0.0' }]);

    await checkForUpdate();
    expect(logger.stdout).toEqual([]);
    expect(logger.stderr).toEqual([
      '\n[percy] A new version of @percy/cli is available! 1.0.0 -> 1.1.0\n'
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
      jasmine.stringContaining('[percy:cli:update:cache] Error: EACCES'),
      '[percy:cli:update] Current version 1.0.0 is up to date (latest is 1.0.0)'
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
      jasmine.stringContaining('[percy:cli:update:cache] Error: EACCES'),
      '[percy:cli:update] Current version 1.0.0 is up to date (latest is 1.0.0)'
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
