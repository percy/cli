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

  // Structural, not a validate() round-trip: onlyAutomate is evaluated when AJV COMPILES
  // the schema, so flipping PERCY_TOKEN inside a spec cannot change the outcome.
  it('declares scaleToFit as an automate-only boolean', () => {
    // The config schema is the one entry with no $id; index into that rather than [0].
    const configSchema = CoreConfig.schemas.find(s => !s.$id);
    expect(configSchema.snapshot.properties.scaleToFit)
      .toEqual({ type: 'boolean', onlyAutomate: true });
  });

  // ...and this proves it is wired into validation, not inert. Asserted RELATIVE to
  // fullPage: onlyAutomate is compiled in from PERCY_TOKEN, which differs between a local
  // run and CI, so an absolute expectation here passes locally and breaks in CI.
  it('gates scaleToFit exactly like fullPage', () => {
    PercyConfig.addSchema(CoreConfig.schemas);
    const errors = PercyConfig.validate({ fullPage: true, scaleToFit: true }, '/config/snapshot') || [];
    const messagesFor = (path) => errors.filter(e => e.path === path).map(e => e.message);

    expect(messagesFor('scaleToFit')).toEqual(messagesFor('fullPage'));
    // An undeclared key would draw 'unknown property' here while fullPage drew none, so
    // this still fails if the schema entry goes missing.
    expect(messagesFor('scaleToFit')).not.toContain('unknown property');
  });
});

describe('ComparisonSchema - scaleToFit metadata', () => {
  beforeEach(() => {
    PercyConfig.addSchema(CoreConfig.schemas);
  });

  // metadata sets additionalProperties:false and PercyConfig.validate DELETES unknown keys
  // from the object it is handed, so an undeclared key is dropped before upload -- silently,
  // with the build still green. A structural assertion would not catch that; this asserts
  // the value survives the round trip.
  it('keeps scaleToFit and appliedScaleFactor on the validated object', () => {
    const options = {
      name: 'snap',
      tag: { name: 'Pixel 10' },
      tiles: [],
      metadata: { screenshotType: 'fullpage', scaleToFit: true, appliedScaleFactor: 0.380952 }
    };

    expect(PercyConfig.validate(options, '/comparison')).toBe(undefined);
    expect(options.metadata).toEqual({
      screenshotType: 'fullpage', scaleToFit: true, appliedScaleFactor: 0.380952
    });
  });

  it('rejects a factor outside (0, 1]', () => {
    const build = (appliedScaleFactor) => PercyConfig.validate({
      name: 'snap', tag: { name: 'Pixel 10' }, tiles: [],
      metadata: { scaleToFit: true, appliedScaleFactor }
    }, '/comparison') || [];

    expect(build(2).map(e => e.path)).toContain('metadata.appliedScaleFactor');
    expect(build(0).map(e => e.path)).toContain('metadata.appliedScaleFactor');
    expect(build(0.380952)).toEqual([]);
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

describe('Discovery config', () => {
  beforeEach(() => {
    PercyConfig.addSchema(CoreConfig.schemas);
  });

  it('should accept autoConfigureAllowedHostnames as boolean', () => {
    const config = {
      discovery: {
        autoConfigureAllowedHostnames: true
      }
    };

    const errors = PercyConfig.validate(config, '/config');
    expect(errors).toBe(undefined);
  });

  it('should accept autoConfigureAllowedHostnames as false', () => {
    const config = {
      discovery: {
        autoConfigureAllowedHostnames: false
      }
    };

    const errors = PercyConfig.validate(config, '/config');
    expect(errors).toBe(undefined);
  });

  it('should default autoConfigureAllowedHostnames to true', () => {
    const config = PercyConfig.load({ overrides: { discovery: {} } });

    expect(config.discovery.autoConfigureAllowedHostnames).toBe(true);
  });

  it('should reject non-boolean values for autoConfigureAllowedHostnames', () => {
    const config = {
      discovery: {
        autoConfigureAllowedHostnames: 'yes'
      }
    };

    const errors = PercyConfig.validate(config, '/config');
    expect(errors).toBeDefined();
    expect(errors[0].path).toBe('discovery.autoConfigureAllowedHostnames');
    expect(errors[0].message).toMatch(/must be a boolean/);
  });
});

describe('Project config', () => {
  beforeEach(() => {
    PercyConfig.addSchema(CoreConfig.schemas);
  });

  it('should accept projectId as a number', () => {
    const config = {
      project: {
        id: 123
      }
    };

    const errors = PercyConfig.validate(config, '/config');
    expect(errors).toBe(undefined);
  });

  it('should reject non-numeric values for projectId', () => {
    const config = {
      project: {
        id: 'abc'
      }
    };

    const errors = PercyConfig.validate(config, '/config');
    expect(errors).toBeDefined();
    expect(errors[0].path).toBe('project.id');
    expect(errors[0].message).toMatch(/must be a number/);
  });

  it('should accept project name as a number', () => {
    const config = {
      project: {
        id: 123,
        name: 'Test Project'
      }
    };

    const errors = PercyConfig.validate(config, '/config');
    expect(errors).toBe(undefined);
  });
});
