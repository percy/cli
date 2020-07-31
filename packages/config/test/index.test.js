import expect from 'expect';
import log from '@percy/logger';
import stdio from '@percy/logger/test/helper';
import mockConfig from './helper';
import PercyConfig from '../src';

describe('PercyConfig', () => {
  beforeEach(() => {
    log.loglevel('warn');
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
    log.loglevel('error');
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

      expect(stdio.capture(() => (
        PercyConfig.validate({
          test: { foo: false },
          baz: ['qux']
        })
      ))).toBe(false);

      expect(stdio[1]).toEqual([
        '[percy] Invalid config:\n',
        "[percy] - 'test' has unknown property 'foo'\n",
        "[percy] - 'baz' should be a number, received an array\n"
      ]);
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

      expect(stdio.capture(() => (
        PercyConfig.validate({
          version: 2,
          test: {
            value: 'foo',
            cov: 99
          }
        })
      ))).toBe(false);

      expect(stdio[1]).toEqual([
        '[percy] Invalid config:\n',
        "[percy] - 'test' has unknown property 'value'\n",
        "[percy] - 'test' is missing required property 'foo'\n",
        "[percy] - 'test.cov' should be >= 100\n"
      ]);
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
    it('returns true when passing', () => {
      expect(PercyConfig.validate({
        version: 2,
        test: { value: 'testing' }
      })).toBe(true);
    });

    it('returns false and logs warnings when failing', () => {
      expect(stdio.capture(() => PercyConfig.validate({
        test: { value: 1, foo: false }
      }))).toBe(false);

      expect(stdio[2]).toHaveLength(0);
      expect(stdio[1]).toEqual([
        '[percy] Invalid config:\n',
        "[percy] - 'test' has unknown property 'foo'\n",
        "[percy] - 'test.value' should be a string, received a number\n"
      ]);
    });

    it('can scrub invalid values when failing', () => {
      let config = { test: { value: 'valid', foo: false } };
      expect(stdio.capture(() => (
        PercyConfig.validate(config, { scrub: true })
      ))).toBe(false);
      expect(config).toHaveProperty('test.value', 'valid');
      expect(config).not.toHaveProperty('test.foo');
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
      log.loglevel('debug');

      expect(stdio.capture(() => (
        PercyConfig.load()
      ))).toEqual({
        version: 2,
        test: { value: 'percy' }
      });

      expect(stdio[2]).toHaveLength(0);
      expect(stdio[1]).toContain(
        '[percy] Found config file: .percy.yml\n'
      );
    });

    it('can search a provided directory for a config file', () => {
      log.loglevel('debug');

      mockConfig('config/.percy.yml', [
        'version: 2',
        'test:',
        '  value: config/percy'
      ].join('\n'));

      expect(stdio.capture(() => (
        PercyConfig.load({ path: 'config/' })
      ))).toEqual({
        version: 2,
        test: { value: 'config/percy' }
      });

      expect(stdio[2]).toHaveLength(0);
      expect(stdio[1]).toContain(
        '[percy] Found config file: config/.percy.yml\n'
      );
    });

    it('returns config options merged with defaults', () => {
      expect(PercyConfig.load({ path: '.defaults.yml' })).toEqual({
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
      log.loglevel('debug');

      expect(stdio.capture(() => (
        PercyConfig.load({ path: '.404.yml' })
      ))).toEqual({
        version: 2,
        test: { value: 'foo' }
      });

      expect(stdio[2]).toHaveLength(0);
      expect(stdio[1]).toEqual([
        '[percy] Config file not found\n'
      ]);
    });

    it('logs when failing to load or parse the config file', () => {
      mockConfig('.error.yml', () => { throw new Error('test'); });
      log.loglevel('debug');

      expect(stdio.capture(() => (
        PercyConfig.load({ path: '.error.yml' })
      ))).toEqual({
        version: 2,
        test: { value: 'foo' }
      });

      expect(stdio[2]).toHaveLength(0);
      expect(stdio[1]).toEqual([
        '[percy] Failed to load or parse config file\n',
        '[percy] Error: test\n'
      ]);
    });

    it('logs loaded and provided config options', () => {
      PercyConfig.addSchema({ fooBar: { type: 'string' } });
      mockConfig('.foo.yml', 'version: 2\nfoo-bar: baz');
      log.loglevel('debug');

      expect(stdio.capture(() => (
        PercyConfig.load({
          path: '.foo.yml',
          overrides: {
            test: { value: 'hi' },
            arr: []
          }
        })
      ))).toEqual({
        version: 2,
        test: { value: 'hi' },
        fooBar: 'baz'
      });

      expect(stdio[2]).toHaveLength(0);
      expect(stdio[1]).toEqual([
        '[percy] Found config file: .foo.yml\n',
        '[percy] Using config:\n' + [
          '{',
          '  version: 2,',
          '  fooBar: \'baz\',',
          '  test: {',
          '    value: \'hi\'',
          '  }',
          '}\n'
        ].join('\n')
      ]);
    });

    it('logs with an missing version and uses default options', () => {
      mockConfig('.no-version.yml', 'test:\n  value: no-version');
      log.loglevel('debug');

      expect(stdio.capture(() => (
        PercyConfig.load({ path: '.no-version.yml' })
      ))).toEqual({
        version: 2,
        test: { value: 'foo' }
      });

      expect(stdio[2]).toHaveLength(0);
      expect(stdio[1]).toEqual([
        '[percy] Found config file: .no-version.yml\n',
        '[percy] Ignoring config file - missing version\n'
      ]);
    });

    it('logs with an invalid version and uses default options', () => {
      mockConfig('.bad-version.yml', 'version: 1\ntest:\n  value: bad-version');
      log.loglevel('debug');

      expect(stdio.capture(() => (
        PercyConfig.load({ path: '.bad-version.yml' })
      ))).toEqual({
        version: 2,
        test: { value: 'foo' }
      });

      expect(stdio[2]).toHaveLength(0);
      expect(stdio[1]).toEqual([
        '[percy] Found config file: .bad-version.yml\n',
        '[percy] Ignoring config file - unsupported version\n'
      ]);
    });

    it('logs validation warnings and scrubs failing properties', () => {
      mockConfig('.invalid.yml', 'version: 2\nfoo: bar');
      log.loglevel('debug');

      expect(stdio.capture(() => (
        PercyConfig.load({
          path: '.invalid.yml',
          overrides: {
            test: { value: 1 },
            arr: {}
          }
        })
      ))).toEqual({
        version: 2,
        test: { value: 'foo' }
      });

      expect(stdio[2]).toHaveLength(0);
      expect(stdio[1]).toEqual([
        '[percy] Found config file: .invalid.yml\n',
        '[percy] Invalid config:\n',
        '[percy] - unknown property \'foo\'\n',
        '[percy] - \'test.value\' should be a string, received a number\n',
        '[percy] - \'arr\' should be an array, received an object\n',
        '[percy] Using config:\n' + [
          '{',
          '  version: 2',
          '}\n'
        ].join('\n')
      ]);
    });

    it('returns undefined on validation warnings when `bail` is true', () => {
      mockConfig('.invalid.yml', 'version: 2\nfoo: bar');
      log.loglevel('debug');

      expect(stdio.capture(() => (
        PercyConfig.load({
          path: '.invalid.yml',
          bail: true,
          overrides: {
            test: { value: 1 },
            arr: {}
          }
        })
      ))).toBeUndefined();

      expect(stdio[2]).toHaveLength(0);
      expect(stdio[1]).toEqual([
        '[percy] Found config file: .invalid.yml\n',
        '[percy] Invalid config:\n',
        '[percy] - unknown property \'foo\'\n',
        '[percy] - \'test.value\' should be a string, received a number\n',
        '[percy] - \'arr\' should be an array, received an object\n'
      ]);
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
        '}'
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
        '}'
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
        '}'
      ].join('\n'));
    });

    it('throws an error with an unrecognized format', () => {
      expect(() => PercyConfig.stringify('foo'))
        .toThrow('Unsupported format: foo');
    });
  });
});
