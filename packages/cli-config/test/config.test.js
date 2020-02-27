import expect from 'expect';
import log from '@percy/logger';
import { mockConfig, stdio } from './helpers';
import PercyConfig from '../src';

describe('PercyConfig', () => {
  beforeEach(() => {
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

      expect(PercyConfig.validate({
        test: { foo: false },
        baz: ['qux']
      })).toEqual([
        "'test' has unknown property 'foo'",
        "'baz' should be a number, received an array"
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

      expect(PercyConfig.validate({
        version: 2,
        test: {
          value: 'foo',
          cov: 99
        }
      })).toEqual([
        "'test' has unknown property 'value'",
        "'test' is missing required property 'foo'",
        "'test.cov' should be >= 100"
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
  });

  describe('.validate()', () => {
    it('returns undefined when passing', () => {
      expect(PercyConfig.validate({
        version: 2,
        test: { value: 'testing' }
      })).toBeUndefined();
    });

    it('returns an array of errors when failing', () => {
      expect(PercyConfig.validate({
        test: { value: 1, foo: false }
      })).toEqual([
        "'test' has unknown property 'foo'",
        "'test.value' should be a string, received a number"
      ]);
    });
  });

  describe('.load()', () => {
    beforeEach(() => {
      PercyConfig.addSchema({ arr: { type: 'array', items: { type: 'string' } } });
      mockConfig('.percy.yml', { version: 2, test: { value: 'percy' } });
      mockConfig('.bar.yml', { version: 2, test: { value: 'bar' } });
      mockConfig('.defaults.yml', { version: 2, arr: ['merged'] });
    });

    it('loads a config file from the provided filepath', () => {
      // mock cosmiconfig.load returns the exact mock
      expect(PercyConfig.load('.bar.yml')).toEqual({
        version: 2,
        test: { value: 'bar' }
      });
    });

    it('searches for specific config files without a filepath', () => {
      // mock consmiconfig.search returns the first mock
      expect(PercyConfig.load()).toEqual({
        version: 2,
        test: { value: 'percy' }
      });
    });

    it('logs the filepath of a found config', () => {
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

    it('returns config options merged with defaults', () => {
      expect(PercyConfig.load('.defaults.yml')).toEqual({
        version: 2,
        test: { value: 'foo' },
        arr: ['merged']
      });
    });

    it('logs when a config file cannot be found', () => {
      log.loglevel('debug');

      expect(stdio.capture(() => (
        PercyConfig.load('.404.yml')
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
        PercyConfig.load('.error.yml')
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
      mockConfig('.foo.yml', { version: 2, 'foo-bar': 'baz' });
      log.loglevel('debug');

      expect(stdio.capture(() => (
        PercyConfig.load('.foo.yml', {
          test: { value: 'hi' },
          arr: []
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
      mockConfig('.no-version.yml', { test: { value: 'no-version' } });
      log.loglevel('debug');

      expect(stdio.capture(() => (
        PercyConfig.load('.no-version.yml')
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
      mockConfig('.bad-version.yml', { version: 1, test: { value: 'bad-version' } });
      log.loglevel('debug');

      expect(stdio.capture(() => (
        PercyConfig.load('.bad-version.yml')
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
      mockConfig('.invalid.yml', { version: 2, foo: 'bar' });
      log.loglevel('debug');

      expect(stdio.capture(() => (
        PercyConfig.load('.invalid.yml', {
          test: { value: 1 },
          arr: {}
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
  });

  describe('.stringify()', () => {
    it('returns an empty string without a format', () => {
      expect(PercyConfig.stringify()).toBe('');
    });

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
  });
});
