import nock from 'nock';
import logger from '@percy/logger/test/helpers';

import {
  mockfs,
  mockRequire,
  mockUpdateCache
} from './helpers';

describe('CLI update check', () => {
  let checkForUpdate, request;

  beforeEach(async () => {
    mockfs();
    logger.mock();

    request = nock('https://api.github.com/repos/percy/cli', {
      reqheaders: { 'User-Agent': ua => !!ua }
    });

    mockRequire('../package.json', { name: '@percy/cli', version: '1.0.0' });
    ({ checkForUpdate } = mockRequire.reRequire('../src/update'));
  });

  afterEach(() => {
    mockfs.reset();
    nock.cleanAll();
  });

  it('fetches and caches the latest release information', async () => {
    request.get('/releases').reply(200, [{ tag_name: 'v1.0.0' }]);

    expect(mockfs.existsSync('.releases')).toBe(false);

    await checkForUpdate();
    expect(logger.stdout).toEqual([]);
    expect(logger.stderr).toEqual([]);
    expect(request.isDone()).toBe(true);

    expect(mockfs.existsSync('.releases')).toBe(true);
    expect(JSON.parse(mockfs.readFileSync('.releases')))
      .toHaveProperty('data', [{ tag: 'v1.0.0' }]);
  });

  it('does not fetch the latest release information if cached', async () => {
    request.get('/releases').reply(200, [{ tag_name: 'v1.0.0' }]);
    mockUpdateCache([{ tag: 'v1.0.0' }]);

    await checkForUpdate();
    expect(logger.stdout).toEqual([]);
    expect(logger.stderr).toEqual([]);
    expect(request.isDone()).toBe(false);
  });

  it('fetchs the latest release information if the cache is outdated', async () => {
    request.get('/releases').reply(200, [{ tag_name: 'v1.0.0' }]);

    let cacheCreatedAt = Date.now() - (30 * 24 * 60 * 60 * 1000);
    mockUpdateCache([{ tag: 'v0.2.0' }, { tag: 'v0.1.0' }], cacheCreatedAt);

    await checkForUpdate();
    expect(logger.stdout).toEqual([]);
    expect(logger.stderr).toEqual([]);
    expect(request.isDone()).toBe(true);

    expect(JSON.parse(mockfs.readFileSync('.releases')))
      .toHaveProperty('data', [{ tag: 'v1.0.0' }]);
  });

  it('warns when a new version is available', async () => {
    mockUpdateCache([{ tag: 'v1.1.0' }, { tag: 'v1.0.0' }]);

    await checkForUpdate();
    expect(logger.stdout).toEqual([]);
    expect(logger.stderr).toEqual([
      '', '[percy] A new version of @percy/cli is available! 1.0.0 -> 1.1.0', ''
    ]);
  });

  it('warns when the current version is outdated', async () => {
    mockUpdateCache([{ tag: 'v2.0.0' }]);

    await checkForUpdate();
    expect(logger.stdout).toEqual([]);
    expect(logger.stderr).toEqual([
      '', '[percy] Heads up! The current version of @percy/cli ' +
        'is more than 10 releases behind! 1.0.0 -> 2.0.0', ''
    ]);
  });

  it('handles errors reading from cache and logs debug info', async () => {
    mockUpdateCache([{ tag: 'v1.0.0' }]);
    mockfs.spyOn('readFileSync').and.throwError(new Error('EACCES'));
    request.get('/releases').reply(200, [{ tag_name: 'v1.0.0' }]).persist();

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

    expect(request.isDone()).toEqual(true);
  });

  it('handles errors writing to cache and logs debug info', async () => {
    mockfs.spyOn('writeFileSync').and.throwError(new Error('EACCES'));
    request.get('/releases').reply(200, [{ tag_name: 'v1.0.0' }]).persist();

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

    expect(request.isDone()).toEqual(true);
    expect(mockfs.existsSync('.releases')).toBe(false);
  });

  it('handles request errors and logs debug info', async () => {
    request.get('/releases').reply(503).persist();

    await checkForUpdate();
    expect(logger.stdout).toEqual([]);
    expect(logger.stderr).toEqual([]);

    logger.loglevel('debug');

    await checkForUpdate();
    expect(logger.stdout).toEqual([]);
    expect(logger.stderr).toEqual([
      '[percy:cli:update] Unable to check for updates',
      jasmine.stringContaining('[percy:cli:update] Error: 503')
    ]);
  });
});
