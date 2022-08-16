import { logger, setupTest, createTestServer } from '@percy/cli-command/test/helpers';
import id from '../src/id.js';

describe('percy build:id', () => {
  let percyServer;

  beforeEach(async () => {
    await setupTest();
  });

  afterEach(async () => {
    delete process.env.PERCY_ENABLE;
    await percyServer?.close();
  });

  it('does nothing and logs when percy is not enabled', async () => {
    process.env.PERCY_ENABLE = '0';
    await id();

    expect(logger.stdout).toEqual([]);
    expect(logger.stderr).toEqual(['[percy] Percy is disabled']);
  });

  it('calls the /percy/healthcheck endpoint and logs the build ID', async () => {
    let res = [200, 'application/json', { build: { id: 123 }, success: true }];
    percyServer = await createTestServer({ '/percy/healthcheck': () => res }, 5338);

    await id();

    expect(logger.stderr).toEqual([]);
    expect(logger.stdout).toEqual(['123']);
    expect(percyServer.requests).toEqual([['/percy/healthcheck']]);
  });

  it('can call the /percy/healthcheck endpoint at an alternate port', async () => {
    let res = [200, 'application/json', { build: { id: 456 }, success: true }];
    percyServer = await createTestServer({ '/percy/healthcheck': () => res }, 4567);

    await id(['--port=4567']);

    expect(logger.stderr).toEqual([]);
    expect(logger.stdout).toEqual(['456']);
    expect(percyServer.requests).toEqual([['/percy/healthcheck']]);
  });

  it('logs an error when the endpoint errors', async () => {
    await expectAsync(id()).toBeRejected();

    expect(logger.stdout).toEqual([]);
    expect(logger.stderr).toEqual(['[percy] Percy is not running']);
  });

  it('logs an error when missing build information', async () => {
    let res = [200, 'application/json', { success: true }];
    percyServer = await createTestServer({ '/percy/healthcheck': () => res }, 5338);

    await expectAsync(id()).toBeRejected();

    expect(logger.stdout).toEqual([]);
    expect(logger.stderr).toEqual(['[percy] Unable to find local build information']);
  });
});
