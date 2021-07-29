import logger from '@percy/logger/test/helpers';
import { configMigration } from '../../src/config';

describe('Unit / Config Migration', () => {
  let mocked = {
    map: (...a) => mocked.migrate.map.push(a),
    del: (...a) => mocked.migrate.del.push(a),
    log: require('@percy/logger')('test')
  };

  beforeEach(() => {
    mocked.migrate = { map: [], del: [] };
    logger.mock();
  });

  it('migrates v1 config', () => {
    configMigration({
      version: 1,
      snapshot: {
        widths: [1000]
      },
      agent: {
        assetDiscovery: {
          requestHeaders: { foo: 'bar' },
          allowedHostnames: ['allowed'],
          networkIdleTimeout: 150,
          pagePoolSizeMin: 1,
          pagePoolSizeMax: 5,
          cacheResponses: false
        }
      }
    }, mocked);

    expect(mocked.migrate.map).toEqual([
      ['agent.assetDiscovery.allowedHostnames', 'discovery.allowedHostnames'],
      ['agent.assetDiscovery.networkIdleTimeout', 'discovery.networkIdleTimeout'],
      ['agent.assetDiscovery.cacheResponses', 'discovery.disableCache', jasmine.any(Function)],
      ['agent.assetDiscovery.requestHeaders', 'discovery.requestHeaders'],
      ['agent.assetDiscovery.pagePoolSizeMax', 'discovery.concurrency']
    ]);

    expect(mocked.migrate.del).toEqual([
      ['agent']
    ]);

    // cacheResponse -> disabeCache map
    expect(mocked.migrate.map[2][2](true)).toEqual(false);
    expect(mocked.migrate.map[2][2](false)).toEqual(true);
  });

  it('logs for currently deprecated options', () => {
    configMigration({
      version: 2,
      snapshot: {
        authorization: {},
        requestHeaders: {}
      }
    }, mocked);

    expect(mocked.migrate.map).toEqual([
      ['snapshot.authorization', 'discovery.authorization'],
      ['snapshot.requestHeaders', 'discovery.requestHeaders']
    ]);

    expect(logger.stderr).toEqual([
      '[percy] Warning: The config option `snapshot.authorization` ' +
        'will be removed in 1.0.0. Use `discovery.authorization` instead.',
      '[percy] Warning: The config option `snapshot.requestHeaders` ' +
        'will be removed in 1.0.0. Use `discovery.requestHeaders` instead.'
    ]);
  });

  it('does not migrate when not needed', () => {
    configMigration({
      version: 2,
      discovery: {
        allowedHostnames: ['allowed']
      }
    }, mocked);

    expect(mocked.migrate.map).toEqual([]);
    expect(mocked.migrate.del).toEqual([]);
  });
});
