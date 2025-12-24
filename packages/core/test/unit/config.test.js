import logger from '@percy/logger/test/helpers';
import { configMigration, snapshotSchema } from '../../src/config.js';
import * as CoreConfig from '@percy/core/config';
import PercyConfig from '@percy/config';

describe('Unit / Config Migration', () => {
  let mocked = {
    deprecate: (...a) => mocked.migrate.deprecate.push(a),
    map: (...a) => mocked.migrate.map.push(a),
    del: (...a) => mocked.migrate.del.push(a)
  };

  beforeEach(async () => {
    mocked.migrate = { deprecate: [], map: [], del: [] };
    await logger.mock();
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

    // cacheResponse -> disableCache map
    expect(mocked.migrate.map[2][2](true)).toEqual(false);
    expect(mocked.migrate.map[2][2](false)).toEqual(true);
  });

  it('migrates deprecated config', () => {
    configMigration({
      version: 2,
      snapshot: {
        devicePixelRatio: 2
      }
    }, mocked);

    expect(mocked.migrate.deprecate).toEqual([
      ['snapshot.devicePixelRatio', {
        map: 'discovery.devicePixelRatio',
        type: 'config',
        until: '2.0.0'
      }]
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

describe('SnapshotSchema', () => {
  it('should contain domTransformation', () => {
    expect(snapshotSchema.$defs.common.properties).toEqual(jasmine.objectContaining({ domTransformation: jasmine.anything() }));
  });

  it('scopeOptions should work with scope', () => {
    const comparison = {
      name: 'snapfoo',
      url: 'some_url',
      widths: [1000],
      scope: '#main',
      scopeOptions: { scroll: true },
      enableJavaScript: true
    };

    PercyConfig.addSchema(CoreConfig.schemas);
    const errors = PercyConfig.validate(comparison, '/snapshot');
    expect(errors).toBe(undefined);
  });

  it('scopeOptions should not work without scope', () => {
    const comparison = {
      name: 'snapfoo',
      url: 'some_url',
      widths: [1000],
      scopeOptions: { scroll: true },
      enableJavaScript: true
    };

    PercyConfig.addSchema(CoreConfig.schemas);
    const errors = PercyConfig.validate(comparison, '/snapshot');
    expect(errors).not.toBe(null);
    expect(errors.length).toBe(1);
    expect(errors[0].path).toBe('scope');
    expect(errors[0].message).toBe('must have property scope when property scopeOptions is present');
  });
});

describe('ComparisonSchema - elementSelectorsData', () => {
  beforeEach(() => {
    PercyConfig.addSchema(CoreConfig.schemas);
  });

  it('should accept valid elementSelectorsData with xpath selector and coordinates', () => {
    const comparison = {
      name: 'test-snapshot',
      tag: {
        name: 'test-tag',
        width: 1280,
        height: 1024
      },
      elementSelectorsData: {
        '//*[@id="__next"]/div/div': {
          success: true,
          top: 0,
          left: 0,
          bottom: 1688.0625,
          right: 1280,
          message: 'Found',
          stacktrace: null
        }
      }
    };

    const errors = PercyConfig.validate(comparison, '/comparison');
    expect(errors).toBe(undefined);
  });

  it('should accept elementSelectorsData with multiple selectors', () => {
    const comparison = {
      name: 'test-snapshot',
      tag: {
        name: 'test-tag',
        width: 1280,
        height: 1024
      },
      elementSelectorsData: {
        '//*[@id="header"]': {
          success: true,
          top: 0,
          left: 0,
          bottom: 100,
          right: 1280,
          message: 'Found',
          stacktrace: null
        },
        '//*[@id="footer"]': {
          success: false,
          top: null,
          left: null,
          bottom: null,
          right: null,
          message: 'Not found',
          stacktrace: 'Element not visible'
        }
      }
    };

    const errors = PercyConfig.validate(comparison, '/comparison');
    expect(errors).toBe(undefined);
  });

  it('should accept elementSelectorsData with success false and stacktrace', () => {
    const comparison = {
      name: 'test-snapshot',
      tag: {
        name: 'test-tag',
        width: 1280,
        height: 1024
      },
      elementSelectorsData: {
        '//div[@class="missing"]': {
          success: false,
          top: 0,
          left: 0,
          bottom: 0,
          right: 0,
          message: 'Element not found',
          stacktrace: 'Timeout waiting for element'
        }
      }
    };

    const errors = PercyConfig.validate(comparison, '/comparison');
    expect(errors).toBe(undefined);
  });

  it('should accept empty elementSelectorsData object', () => {
    const comparison = {
      name: 'test-snapshot',
      tag: {
        name: 'test-tag',
        width: 1280,
        height: 1024
      },
      elementSelectorsData: {}
    };

    const errors = PercyConfig.validate(comparison, '/comparison');
    expect(errors).toBe(undefined);
  });

  it('should accept elementSelectorsData with decimal coordinates', () => {
    const comparison = {
      name: 'test-snapshot',
      tag: {
        name: 'test-tag',
        width: 1280,
        height: 1024
      },
      elementSelectorsData: {
        '//*[@id="content"]': {
          success: true,
          top: 100.5,
          left: 50.25,
          bottom: 500.75,
          right: 1200.125,
          message: 'Found',
          stacktrace: null
        }
      }
    };

    const errors = PercyConfig.validate(comparison, '/comparison');
    expect(errors).toBe(undefined);
  });

  it('should accept elementSelectorsData with negative coordinates', () => {
    const comparison = {
      name: 'test-snapshot',
      tag: {
        name: 'test-tag',
        width: 1280,
        height: 1024
      },
      elementSelectorsData: {
        '//*[@id="offscreen"]': {
          success: true,
          top: -100,
          left: -50,
          bottom: 0,
          right: 0,
          message: 'Found off-screen',
          stacktrace: null
        }
      }
    };

    const errors = PercyConfig.validate(comparison, '/comparison');
    expect(errors).toBe(undefined);
  });
});
