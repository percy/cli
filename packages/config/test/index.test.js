import path from 'path';
import logger from '@percy/logger/test/helpers';
import mockConfig from './helpers';
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
      })).toEqual([{
        path: 'test.foo',
        message: 'unknown property'
      }, {
        path: 'baz',
        message: 'must be a number, received an array'
      }]);
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
      })).toEqual([{
        path: 'test.foo',
        message: 'missing required property'
      }, {
        path: 'test.value',
        message: 'unknown property'
      }, {
        path: 'test.cov',
        message: 'must be >= 100'
      }]);
    });

    it('can add schemas without altering the config schema', () => {
      PercyConfig.addSchema({
        $id: 'foo',
        type: 'object',
        properties: {
          foo: {
            type: 'string',
            const: 'bar',
            default: 'bar'
          },
          bar: {
            type: 'string'
          }
        }
      });

      expect(PercyConfig.getDefaults()).toEqual({
        version: 2,
        test: { value: 'foo' }
      });

      expect(PercyConfig.validate({
        foo: 'baz',
        bar: null
      }, 'foo')).toEqual([{
        path: 'foo',
        message: 'must be equal to constant'
      }, {
        path: 'bar',
        message: 'must be a string, received null'
      }]);
    });

    it('can add schemas to replace existing schemas', () => {
      PercyConfig.addSchema({
        $id: 'foo',
        type: 'string'
      });

      PercyConfig.addSchema({
        $id: 'foo',
        type: 'number'
      });

      expect(PercyConfig.validate('foo', 'foo')).toEqual([{
        path: '',
        message: 'must be a number, received a string'
      }]);
    });

    it('can add multiple schemas at a time', () => {
      PercyConfig.addSchema([{
        foo: { type: 'string' }
      }, {
        bar: { $ref: '/config/foo' }
      }]);

      expect(PercyConfig.validate({
        foo: 'bar',
        bar: 100
      })).toEqual([{
        path: 'bar',
        message: 'must be a string, received a number'
      }]);
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
    it('returns undefined when passing', () => {
      expect(PercyConfig.validate({
        version: 2,
        test: { value: 'testing' }
      })).toBeUndefined();
    });

    it('returns an array of errors when failing', () => {
      PercyConfig.addSchema({
        foo: {
          type: 'string',
          pattern: '^[a-zA-z]*$',
          errors: {
            pattern: 'must not contain numbers'
          }
        },
        bar: {
          type: 'object',
          oneOf: [{
            anyOf: [{
              not: { required: ['one'] }
            }]
          }, {
            required: ['two']
          }],
          properties: {
            one: { type: 'number', const: 1 },
            two: { type: 'number', const: 2 }
          },
          errors: {
            oneOf: ({ params }) => (
              `must pass a single schema, passed ${params.passingSchemas ?? 0}`
            )
          }
        }
      });

      expect(PercyConfig.validate({
        test: { value: 1, foo: 'bar' },
        foo: 'He11o',
        bar: { one: 1 }
      })).toEqual([{
        path: 'test.foo',
        message: 'unknown property'
      }, {
        path: 'test.value',
        message: 'must be a string, received a number'
      }, {
        path: 'foo',
        message: 'must not contain numbers'
      }, {
        path: 'bar',
        message: 'must pass a single schema, passed 0'
      }]);
    });

    it('clamps minimum and maximum schemas', () => {
      PercyConfig.addSchema({
        min: { type: 'number', minimum: 10 },
        max: { type: 'number', maximum: 20 }
      });

      let conf = { min: 5, max: 50 };

      expect(PercyConfig.validate(conf)).toEqual([{
        path: 'min',
        message: 'must be >= 10'
      }, {
        path: 'max',
        message: 'must be <= 20'
      }]);

      expect(conf).toEqual({ min: 10, max: 20 });
    });

    it('scrubs invalid properties', () => {
      PercyConfig.addSchema({
        foo: {
          type: 'array',
          items: {
            type: 'object',
            oneOf: [
              { required: ['bar'] },
              { required: ['baz'] },
              { required: ['qux'] }
            ],
            properties: {
              bar: { const: 'baz' },
              baz: { const: 'qux' },
              qux: { const: 'xyzzy' }
            },
            errors: {
              oneOf: 'missing metasyntactic variable'
            }
          }
        }
      });

      let conf = { foo: [{}, { baz: 'qux' }, { qux: 'quux' }] };

      expect(PercyConfig.validate(conf)).toEqual([{
        path: 'foo[0]',
        message: 'missing metasyntactic variable'
      }, {
        path: 'foo[2].qux',
        message: 'must be equal to constant'
      }]);

      expect(conf).toEqual({ foo: [{ baz: 'qux' }] });
    });

    it('scrubs properties with missing required nested properties', () => {
      PercyConfig.addSchema({
        foo: {
          type: 'object',
          required: ['bar'],
          properties: {
            bar: { const: 'baz' }
          }
        }
      });

      let conf = { foo: { qux: 'xyzzy' } };

      expect(PercyConfig.validate(conf)).toEqual([{
        path: 'foo.bar',
        message: 'missing required property'
      }]);

      expect(conf).toEqual({});
    });

    it('can validate functions and regular expressions', () => {
      PercyConfig.addSchema({
        func: { instanceof: 'Function' },
        regex: { instanceof: 'RegExp' }
      });

      expect(PercyConfig.validate({
        func: () => {},
        regex: /foobar/g
      })).toBeUndefined();

      expect(PercyConfig.validate({
        func: '() => {}',
        regex: '/foobar/g'
      })).toEqual([{
        path: 'func',
        message: 'must be an instanceof Function'
      }, {
        path: 'regex',
        message: 'must be an instanceof RegExp'
      }]);
    });

    it('can validate disallowed properties', () => {
      PercyConfig.addSchema({
        test: {
          type: 'object',
          additionalProperties: false,
          disallowed: ['foo', 'bar'],
          properties: {
            foo: { type: 'number' },
            bar: { type: 'number' },
            baz: { type: 'number' }
          }
        }
      });

      expect(PercyConfig.validate({
        test: { foo: 1, bar: 2, baz: 3 }
      })).toEqual([{
        path: 'test.foo',
        message: 'disallowed property'
      }, {
        path: 'test.bar',
        message: 'disallowed property'
      }]);
    });
  });

  describe('.migrate()', () => {
    beforeEach(() => {
      PercyConfig.addMigration((config, util) => {
        if (config.foo) util.map('foo', 'foo.bar');
      });

      PercyConfig.addMigration((config, util) => {
        if (config.test?.set) util.set('test.value', config.test.set);
        if (config.test?.map) util.map('value.test', ['test', 'value']);
        if (config.test?.map2) util.map(['value', 'test'], 'test.value', v => v * 2);
        if (config.test?.del) util.del('value');
        util.del('test.set', 'test.map', ['test', 'map2'], ['test', 'del']);
      });
    });

    it('runs registered migration functions', () => {
      expect(PercyConfig.migrate({
        version: 1,
        foo: 'baz',
        test: { map: true }
      })).toEqual({
        version: 2,
        foo: { bar: 'baz' }
      });
    });

    it('can set, map, or delete values', () => {
      expect(PercyConfig.migrate({
        version: 1,
        test: { set: 'test' }
      })).toEqual({
        version: 2,
        test: { value: 'test' }
      });

      expect(PercyConfig.migrate({
        version: 1,
        test: { map: true },
        value: { test: 'foo' }
      })).toEqual({
        version: 2,
        test: { value: 'foo' }
      });

      expect(PercyConfig.migrate({
        version: 1,
        test: { map2: true },
        value: { test: 15 }
      })).toEqual({
        version: 2,
        test: { value: 30 }
      });

      expect(PercyConfig.migrate({
        version: 1,
        test: { del: true },
        value: 'testing'
      })).toEqual({
        version: 2
      });
    });

    it('can handle array and array-like paths', () => {
      PercyConfig.addMigration((config, util) => {
        if (config.arr) util.map('arr', 'arr[1].foo[bar][baz]');
      });

      expect(PercyConfig.migrate({
        version: 1,
        arr: 'qux'
      })).toEqual({
        version: 2,
        arr: [undefined, {
          foo: { bar: { baz: 'qux' } }
        }]
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
        '[percy] Found config file: .percy.yml'
      );
    });

    it('can search a provided directory for a config file', () => {
      let filename = path.join('config', '.percy.yml');
      logger.loglevel('debug');

      mockConfig(filename, [
        'version: 2',
        'test:',
        '  value: config/percy'
      ].join('\n'));

      expect(PercyConfig.load({ path: 'config' }))
        .toEqual({
          version: 2,
          test: { value: 'config/percy' }
        });

      expect(logger.stdout).toEqual([]);
      expect(logger.stderr).toContain(
        `[percy:config] Found config file: ${filename}`
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
        '[percy:config] Config file not found'
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
        jasmine.stringMatching('\\[percy] Error: test')
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
        '[percy:config] Found config file: .foo.yml',
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
          '}'
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
        '[percy:config] Found config file: .no-version.yml',
        '[percy:config] Ignoring config file - missing or invalid version'
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
        '[percy:config] Found config file: .bad-version.yml',
        '[percy:config] Ignoring config file - unsupported version "3"'
      ]);
    });

    it('warns with an older version and uses migrated options', () => {
      mockConfig('.old-version.yml', 'version: 1\nvalue: old-value');
      logger.loglevel('debug');

      PercyConfig.addMigration((config, util) => {
        util.map('value', 'test.value', v => v.replace('old', 'new'));
      });

      expect(PercyConfig.load({ path: '.old-version.yml' }))
        .toEqual({
          version: 2,
          test: { value: 'new-value' }
        });

      expect(logger.stdout).toEqual([]);
      expect(logger.stderr).toEqual([
        '[percy:config] Found config file: .old-version.yml',
        '[percy:config] Found older config file version, please run ' +
          '`percy config:migrate` to update to the latest version',
        '[percy:config] Using config:\n' + [
          '{',
          '  version: 2,',
          '  test: {',
          '    value: \'new-value\'',
          '  }',
          '}'
        ].join('\n')
      ]);
    });

    it('logs validation warnings and scrubs failing properties', () => {
      mockConfig('.invalid.yml', 'version: 2\nfoo: bar');
      PercyConfig.addSchema({
        obj: {
          type: 'object',
          additionalProperties: false,
          properties: {
            foo: { type: 'string' }
          }
        }
      });

      logger.loglevel('debug');
      expect(PercyConfig.load({
        path: '.invalid.yml',
        overrides: {
          test: { value: 1 },
          arr: { one: 1 },
          obj: { foo: 'bar', bar: 'baz' }
        }
      })).toEqual({
        version: 2,
        test: { value: 'foo' },
        obj: { foo: 'bar' }
      });

      expect(logger.stdout).toEqual([]);
      expect(logger.stderr).toEqual([
        '[percy:config] Found config file: .invalid.yml',
        '[percy:config] Invalid config:',
        '[percy:config] - foo: unknown property',
        '[percy:config] - test.value: must be a string, received a number',
        '[percy:config] - arr: must be an array, received an object',
        '[percy:config] - obj.bar: unknown property',
        '[percy:config] Using config:\n' + [
          '{',
          '  version: 2,',
          '  obj: {',
          '    foo: \'bar\'',
          '  }',
          '}'
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
          arr: { one: 1 }
        }
      })).toBeUndefined();

      expect(logger.stdout).toEqual([]);
      expect(logger.stderr).toEqual([
        '[percy:config] Found config file: .invalid.yml',
        '[percy:config] Invalid config:',
        '[percy:config] - foo: unknown property',
        '[percy:config] - test.value: must be a string, received a number',
        '[percy:config] - arr: must be an array, received an object'
      ]);
    });
  });

  describe('.normalize()', () => {
    it('removes empty values', () => {
      expect(PercyConfig.normalize({
        foo: 'bar',
        arr: [{}, {}, null],
        obj: { val: undefined },
        nested: { arr: [undefined], bar: null }
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

    it('ignores normalizing specific nested objects', () => {
      expect(PercyConfig.normalize({
        'request-headers': {
          'X-Custom-Header': 'custom header'
        }
      })).toEqual({
        requestHeaders: {
          'X-Custom-Header': 'custom header'
        }
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
        .toThrowError('Unsupported format: foo');
    });
  });
});
