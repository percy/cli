import expect from 'expect';
import logger from '@percy/logger/test/helper';
import mockConfig from './helper';
import PercyConfig from '../src';

describe('PercyConfig', () => {
  beforeEach(() => {
    logger.mock();
    PercyConfig.addSchema({
      test: {
        type: 'object',
        additionalProperties: false,
        properties: {
          value: {
            type: 'string',
            default: 'foo'
          }
        }
      }
    });
  });

  afterEach(() => {
    PercyConfig.cache.clear();
    PercyConfig.resetSchema();
    PercyConfig.clearMigrations();
  });

  describe('.addSchema()', () => {
    it('adds additional properties to the schema', () => {
      PercyConfig.addSchema({
        foo: { type: 'string', default: 'bar' },
        baz: { type: 'number' }
      });

      expect(PercyConfig.getDefaults()).toEqual({
        version: 2,
        test: { value: 'foo' },
        foo: 'bar'
      });

      expect(PercyConfig.validate({
        test: { foo: false },
        baz: ['qux']
      })).toEqual({
        result: false,
        errors: [{
          path: ['test', 'foo'],
          message: 'unknown property'
        }, {
          path: ['baz'],
          message: 'should be a number, received an array'
        }]
      });
    });

    it('replaces existing properties in the schema', () => {
      PercyConfig.addSchema({
        test: {
          type: 'object',
          required: ['foo'],
          additionalProperties: false,
          properties: {
            foo: { type: 'string' },
            cov: { type: 'number', minimum: 100 }
          }
        }
      });

      expect(PercyConfig.getDefaults()).toEqual({
        version: 2
      });

      expect(PercyConfig.validate({
        version: 2,
        test: {
          value: 'foo',
          cov: 99
        }
      })).toEqual({
        result: false,
        errors: [{
          path: ['test', 'foo'],
          message: 'missing required property'
        }, {
          path: ['test', 'value'],
          message: 'unknown property'
        }, {
          path: ['test', 'cov'],
          message: 'should be >= 100'
        }]
      });
    });
  });

  describe('.getDefaults()', () => {
    it('returns the version number with schema defaults', () => {
      expect(PercyConfig.getDefaults()).toEqual({
        version: 2,
        test: { value: 'foo' }
      });
    });

    it('accepts default overrides', () => {
      expect(PercyConfig.getDefaults({
        test: { value: 'bar' }
      })).toEqual({
        version: 2,
        test: { value: 'bar' }
      });
    });
  });

  describe('.validate()', () => {
    it('returns a passing result with no errors', () => {
      expect(PercyConfig.validate({
        version: 2,
        test: { value: 'testing' }
      })).toEqual({
        result: true,
        errors: []
      });
    });

    it('returns a failing result with errors', () => {
      expect(PercyConfig.validate({
        test: { value: 1, foo: 'bar' }
      })).toEqual({
        result: false,
        errors: [{
          path: ['test', 'foo'],
          message: 'unknown property'
        }, {
          path: ['test', 'value'],
          message: 'should be a string, received a number'
        }]
      });
    });
  });

  describe('.migrate()', () => {
    beforeEach(() => {
      PercyConfig.addMigration((input, set) => {
        if (input.test != null) set('value', input.test);
      });

      PercyConfig.addMigration((input, set) => {
        if (input.foo != null) set('foo.bar', input.foo);
      });
    });

    it('runs registered migration functions', () => {
      expect(PercyConfig.migrate({
        version: 1,
        test: 'testing',
        foo: 'baz'
      })).toEqual({
        version: 2,
        value: 'testing',
        foo: { bar: 'baz' }
      });
    });
  });

  describe('.load()', () => {
    beforeEach(() => {
      PercyConfig.addSchema({
        arr: {
          type: 'array',
          items: { type: 'string' }
        }
      });

      mockConfig('.percy.yml', [
        'version: 2',
        'test:',
        '  value: percy'
      ].join('\n'));

      mockConfig('.bar.yml', [
        'version: 2',
        'test:',
        '  value: bar'
      ].join('\n'));

      mockConfig('.defaults.yml', [
        'version: 2',
        'arr: [merged]'
      ].join('\n'));
    });

    it('loads a config file from the provided filepath', () => {
      // mock cosmiconfig.load returns the exact mock
      expect(PercyConfig.load({ path: '.bar.yml' })).toEqual({
        version: 2,
        test: { value: 'bar' }
      });
    });

    it('searches for specific config files without a path', () => {
      expect(PercyConfig.load()).toEqual({
        version: 2,
        test: { value: 'percy' }
      });
    });

    it('does not search for config files when path is false', () => {
      expect(PercyConfig.load({ path: false })).toEqual({
        version: 2,
        test: { value: 'foo' }
      });
    });

    it('logs the path of a found config', () => {
      expect(PercyConfig.load({ print: true }))
        .toEqual({
          version: 2,
          test: { value: 'percy' }
        });

      expect(logger.stderr).toEqual([]);
      expect(logger.stdout).toContain(
        '[percy] Found config file: .percy.yml\n'
      );
    });

    it('can search a provided directory for a config file', () => {
      logger.loglevel('debug');

      mockConfig('config/.percy.yml', [
        'version: 2',
        'test:',
        '  value: config/percy'
      ].join('\n'));

      expect(PercyConfig.load({ path: 'config/' }))
        .toEqual({
          version: 2,
          test: { value: 'config/percy' }
        });

      expect(logger.stdout).toEqual([]);
      expect(logger.stderr).toContain(
        '[percy:config] Found config file: config/.percy.yml\n'
      );
    });

    it('returns config options merged with defaults', () => {
      expect(PercyConfig.load({ path: '.defaults.yml' }))
        .toEqual({
          version: 2,
          test: { value: 'foo' },
          arr: ['merged']
        });
    });

    it('caches config files on subsequent loads', () => {
      let loads = 0;
      mockConfig('.cached.yml', () => ++loads && 'version: 2');
      PercyConfig.load({ path: '.cached.yml' });
      PercyConfig.load({ path: '.cached.yml' });
      PercyConfig.load({ path: '.cached.yml' });
      expect(loads).toBe(1);
    });

    it('reloads cached config files when `reload` is true', () => {
      let loads = 0;
      mockConfig('.cached.yml', () => ++loads && 'version: 2');
      PercyConfig.load({ path: '.cached.yml' });
      PercyConfig.load({ path: '.cached.yml' });
      PercyConfig.load({ path: '.cached.yml', reload: true });
      expect(loads).toBe(2);
    });

    it('logs when a config file cannot be found', () => {
      logger.loglevel('debug');

      expect(PercyConfig.load({ path: '.404.yml' }))
        .toEqual({
          version: 2,
          test: { value: 'foo' }
        });

      expect(logger.stdout).toEqual([]);
      expect(logger.stderr).toEqual([
        '[percy:config] Config file not found\n'
      ]);
    });

    it('logs when failing to load or parse the config file', () => {
      mockConfig('.error.yml', () => { throw new Error('test'); });

      expect(PercyConfig.load({ path: '.error.yml', print: true }))
        .toEqual({
          version: 2,
          test: { value: 'foo' }
        });

      expect(logger.stdout).toEqual([]);
      expect(logger.stderr).toEqual([
        '[percy] Failed to load or parse config file\n',
        expect.stringContaining('[percy] Error: test')
      ]);
    });

    it('logs loaded and provided config options', () => {
      PercyConfig.addSchema({
        fooBar: { type: 'string' },
        merge: { type: 'object' },
        arr: {
          type: 'array',
          items: { type: 'string' },
          default: ['1', '2', '3']
        }
      });

      mockConfig('.foo.yml', [
        'version: 2',
        'foo-bar: baz',
        'arr: [one, two]',
        'merge:',
        '  foo: bar'
      ].join('\n'));

      logger.loglevel('debug');
      expect(PercyConfig.load({
        path: '.foo.yml',
        overrides: {
          arr: ['three'],
          test: { value: 'hi' },
          merge: {}
        }
      })).toEqual({
        version: 2,
        arr: ['one', 'two', 'three'],
        test: { value: 'hi' },
        merge: { foo: 'bar' },
        fooBar: 'baz'
      });

      expect(logger.stdout).toEqual([]);
      expect(logger.stderr).toEqual([
        '[percy:config] Found config file: .foo.yml\n',
        '[percy:config] Using config:\n' + [
          '{',
          '  version: 2,',
          '  fooBar: \'baz\',',
          '  arr: [',
          '    \'one\',',
          '    \'two\',',
          '    \'three\'',
          '  ],',
          '  merge: {',
          '    foo: \'bar\'',
          '  },',
          '  test: {',
          '    value: \'hi\'',
          '  }',
          '}\n'
        ].join('\n')
      ]);
    });

    it('warns with a missing version and uses default options', () => {
      mockConfig('.no-version.yml', 'test:\n  value: no-version');
      logger.loglevel('debug');

      expect(PercyConfig.load({ path: '.no-version.yml' }))
        .toEqual({
          version: 2,
          test: { value: 'foo' }
        });

      expect(logger.stdout).toEqual([]);
      expect(logger.stderr).toEqual([
        '[percy:config] Found config file: .no-version.yml\n',
        '[percy:config] Ignoring config file - missing or invalid version\n'
      ]);
    });

    it('warns with an unsupported version and uses default options', () => {
      mockConfig('.bad-version.yml', 'version: 3\ntest:\n  value: bad-version');
      logger.loglevel('debug');

      expect(PercyConfig.load({ path: '.bad-version.yml' }))
        .toEqual({
          version: 2,
          test: { value: 'foo' }
        });

      expect(logger.stdout).toEqual([]);
      expect(logger.stderr).toEqual([
        '[percy:config] Found config file: .bad-version.yml\n',
        '[percy:config] Ignoring config file - unsupported version "3"\n'
      ]);
    });

    it('warns with an older version and uses migrated options', () => {
      mockConfig('.old-version.yml', 'version: 1\nvalue: old-value');
      logger.loglevel('debug');

      PercyConfig.addMigration((input, set) => {
        set('test.value', input.value.replace('old', 'new'));
      });

      expect(PercyConfig.load({ path: '.old-version.yml' }))
        .toEqual({
          version: 2,
          test: { value: 'new-value' }
        });

      expect(logger.stdout).toEqual([]);
      expect(logger.stderr).toEqual([
        '[percy:config] Found config file: .old-version.yml\n',
        '[percy:config] Found older config file version, please run ' +
          '`percy config:migrate` to update to the latest version\n',
        '[percy:config] Using config:\n' + [
          '{',
          '  version: 2,',
          '  test: {',
          '    value: \'new-value\'',
          '  }',
          '}\n'
        ].join('\n')
      ]);
    });

    it('logs validation warnings and scrubs failing properties', () => {
      mockConfig('.invalid.yml', 'version: 2\nfoo: bar');
      PercyConfig.addSchema({
        req: {
          type: 'object',
          required: ['foo', 'bar'],
          properties: {
            foo: { type: 'string' },
            bar: { type: 'string' }
          }
        }
      });

      logger.loglevel('debug');
      expect(PercyConfig.load({
        path: '.invalid.yml',
        overrides: {
          test: { value: 1 },
          arr: { 1: 'one' },
          req: { foo: 'bar' }
        }
      })).toEqual({
        version: 2,
        test: { value: 'foo' },
        req: { foo: 'bar' }
      });

      expect(logger.stdout).toEqual([]);
      expect(logger.stderr).toEqual([
        '[percy:config] Found config file: .invalid.yml\n',
        '[percy:config] Invalid config:\n',
        '[percy:config] - foo: unknown property\n',
        '[percy:config] - test.value: should be a string, received a number\n',
        '[percy:config] - arr: should be an array, received an object\n',
        '[percy:config] - req.bar: missing required property\n',
        '[percy:config] Using config:\n' + [
          '{',
          '  version: 2,',
          '  req: {',
          '    foo: \'bar\'',
          '  }',
          '}\n'
        ].join('\n')
      ]);
    });

    it('returns undefined on validation warnings when `bail` is true', () => {
      mockConfig('.invalid.yml', 'version: 2\nfoo: bar');
      logger.loglevel('debug');

      expect(PercyConfig.load({
        path: '.invalid.yml',
        bail: true,
        overrides: {
          test: { value: 1 },
          arr: { 1: 'one' }
        }
      })).toBeUndefined();

      expect(logger.stdout).toEqual([]);
      expect(logger.stderr).toEqual([
        '[percy:config] Found config file: .invalid.yml\n',
        '[percy:config] Invalid config:\n',
        '[percy:config] - foo: unknown property\n',
        '[percy:config] - test.value: should be a string, received a number\n',
        '[percy:config] - arr: should be an array, received an object\n'
      ]);
    });
  });

  describe('.normalize()', () => {
    it('removes empty values', () => {
      expect(PercyConfig.normalize({
        foo: 'bar',
        arr: [{}, {}],
        obj: { val: undefined },
        nested: { arr: [undefined] }
      })).toEqual({
        foo: 'bar'
      });
    });

    it('converts keys to camelCase', () => {
      expect(PercyConfig.normalize({
        'foo-bar': 'baz',
        foo: { bar_baz: 'qux' },
        'foo_bar-baz': 'qux',
        'percy-css': '',
        'enable-javascript': false
      })).toEqual({
        fooBar: 'baz',
        foo: { barBaz: 'qux' },
        fooBarBaz: 'qux',
        percyCSS: '',
        enableJavaScript: false
      });
    });

    it('can converts keys to kebab-case', () => {
      expect(PercyConfig.normalize({
        'foo-bar': 'baz',
        foo: { bar_baz: 'qux' },
        fooBar_baz: 'qux',
        percyCSS: '',
        enableJavaScript: false
      }, { kebab: true })).toEqual({
        'foo-bar': 'baz',
        foo: { 'bar-baz': 'qux' },
        'foo-bar-baz': 'qux',
        'percy-css': '',
        'enable-javascript': false
      });
    });
  });

  describe('.stringify()', () => {
    it('formats the default config', () => {
      expect(PercyConfig.stringify('json')).toBe([
        '{',
        '  "version": 2,',
        '  "test": {',
        '    "value": "foo"',
        '  }',
        '}\n'
      ].join('\n'));
    });

    it('formats config as yaml', () => {
      expect(PercyConfig.stringify('yml', {
        foo: { bar: 'baz' }
      })).toBe([
        'foo:',
        '  bar: baz\n'
      ].join('\n'));

      expect(PercyConfig.stringify('yaml', {
        foo: { bar: 'baz' }
      })).toBe([
        'foo:',
        '  bar: baz\n'
      ].join('\n'));
    });

    it('formats config as json', () => {
      expect(PercyConfig.stringify('json', {
        foo: { bar: 'baz' }
      })).toBe([
        '{',
        '  "foo": {',
        '    "bar": "baz"',
        '  }',
        '}\n'
      ].join('\n'));
    });

    it('formats config as js', () => {
      expect(PercyConfig.stringify('js', {
        foo: { bar: 'baz' }
      })).toBe([
        'module.exports = {',
        '  foo: {',
        '    bar: \'baz\'',
        '  }',
        '}\n'
      ].join('\n'));
    });

    it('throws an error with an unrecognized format', () => {
      expect(() => PercyConfig.stringify('foo'))
        .toThrow('Unsupported format: foo');
    });
  });
});
