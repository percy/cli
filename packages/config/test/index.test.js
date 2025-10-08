import logger from '@percy/logger/test/helpers';
import { resetPercyConfig, mockfs, fs } from './helpers.js';
import PercyConfig from '@percy/config';

describe('PercyConfig', () => {
  beforeEach(async () => {
    await resetPercyConfig(true);
    await logger.mock();
    await mockfs();

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

    it('can manipulate other attributes of the config schema', () => {
      PercyConfig.addSchema([{
        $config: {
          properties: {
            test: { const: 'foo' }
          }
        }
      }, {
        $config: c => ({
          properties: {
            test: {
              oneOf: [c.properties.test, { const: 'bar' }],
              errors: { oneOf: 'invalid' }
            }
          }
        })
      }]);

      expect(PercyConfig.validate({ test: 'foo' })).toBeUndefined();
      expect(PercyConfig.validate({ test: 'bar' })).toBeUndefined();
      expect(PercyConfig.validate({ test: 'baz' })).toEqual([
        { path: 'test', message: 'invalid' }
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

    it('does not allow prototype pollution via __proto__', () => {
      const pollutedKey = 'pollutedKey';
      const overrides = JSON.parse('{"__proto__":{"pollutedKey":123}}');
      const result = PercyConfig.getDefaults(overrides);
      expect(result).not.toHaveProperty(pollutedKey);
      expect({}).not.toHaveProperty(pollutedKey);
      expect(result).toEqual({
        version: 2,
        test: { value: 'foo' }
      });
    });

    it('does not allow prototype pollution via __proto__ for nested key', () => {
      const pollutedKey = 'pollutedKey';
      const overrides = JSON.parse('{"pollutedKey":{"__proto__":123}}');
      const result = PercyConfig.getDefaults(overrides);
      expect(result).not.toHaveProperty(pollutedKey);
      expect({}).not.toHaveProperty(pollutedKey);
      expect(result).toEqual({
        version: 2,
        test: { value: 'foo' }
      });
    });

    it('does allow safe key', () => {
      const overrides = JSON.parse('{"key":{"key1":123}}');
      const result = PercyConfig.getDefaults(overrides);
      expect(result).toEqual({
        version: 2,
        test: { value: 'foo' },
        key: { key1: 123 }
      });
    });

    it('does allow regex', () => {
      const overrides = { key: { key1: /\d$/ } };
      const result = PercyConfig.getDefaults(overrides);
      expect(result).toEqual({
        version: 2,
        test: { value: 'foo' },
        key: { key1: /\d$/ }
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
              `must pass a single schema, passed ${params.passingSchemas?.length ?? 0}`
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

    it('does not scrub properties that match at least one schema', () => {
      PercyConfig.addSchema({
        foo: {
          type: 'object',
          properties: {
            bar: { const: 'baz' },
            qux: { const: 'xyzzy' }
          },
          oneOf: [
            { required: ['bar'] },
            { required: ['qux'] }
          ],
          errors: {
            oneOf: ({ params }) => (
              `only 1 schema should match (matched ${params.passingSchemas?.length})`
            )
          }
        }
      });

      let conf = { foo: { bar: 'baz', qux: 'xyzzy' } };

      expect(PercyConfig.validate(conf)).toEqual([{
        path: 'foo',
        message: 'only 1 schema should match (matched 2)'
      }]);

      expect(conf).toEqual({ foo: { bar: 'baz', qux: 'xyzzy' } });
    });

    describe('validates automate integration specific properties', () => {
      beforeEach(() => {
        delete process.env.PERCY_TOKEN;

        PercyConfig.addSchema({
          test: {
            type: 'object',
            additionalProperties: false,
            properties: {
              foo: {
                type: 'number',
                onlyAutomate: true
              },
              bar: {
                type: 'number'
              }
            }
          }
        });
      });

      it('passes when no token present', () => {
        expect(PercyConfig.validate({
          test: {
            foo: 1,
            bar: 2
          }
        })).toBeUndefined();
      });

      it('passes when token is of automate project', () => {
        process.env.PERCY_TOKEN = 'auto_PERCY_TOKEN';

        expect(PercyConfig.validate({
          test: {
            foo: 1,
            bar: 2
          }
        })).toBeUndefined();
      });

      it('warns when token is of legacy web project', () => {
        process.env.PERCY_TOKEN = 'PERCY_TOKEN';

        expect(PercyConfig.validate({
          test: {
            foo: 1,
            bar: 2
          }
        })).toEqual([{
          path: 'test.foo',
          message: 'property only valid with Automate integration.'
        }]);
      });

      it('warns when token is of web project', () => {
        process.env.PERCY_TOKEN = 'web_PERCY_TOKEN';

        expect(PercyConfig.validate({
          test: {
            foo: 1,
            bar: 2
          }
        })).toEqual([{
          path: 'test.foo',
          message: 'property only valid with Automate integration.'
        }]);
      });

      it('warns when token is of app project', () => {
        process.env.PERCY_TOKEN = 'app_PERCY_TOKEN';

        expect(PercyConfig.validate({
          test: {
            foo: 1,
            bar: 2
          }
        })).toEqual([{
          path: 'test.foo',
          message: 'property only valid with Automate integration.'
        }]);
      });

      it('warns when token is of self serve project', () => {
        process.env.PERCY_TOKEN = 'ss_PERCY_TOKEN';

        expect(PercyConfig.validate({
          test: {
            foo: 1,
            bar: 2
          }
        })).toEqual([{
          path: 'test.foo',
          message: 'property only valid with Automate integration.'
        }]);
      });
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

    it('handles complex conditional schemas', () => {
      PercyConfig.addSchema({
        $id: '/test/complex',
        $ref: '/test/complex#/$defs/complete',
        $defs: {
          condition: {
            isTrue: {
              required: ['condition'],
              properties: { condition: { const: true } }
            },
            isNotFalse: {
              not: {
                required: ['condition'],
                properties: { condition: { const: false } }
              }
            },
            disallowBar: {
              disallowed: ['bar'],
              error: 'disallowed with condition enabled'
            }
          },
          common: {
            type: 'object',
            if: { $ref: '/test/complex#/$defs/condition/isTrue' },
            then: { $ref: '/test/complex#/$defs/condition/disallowBar' },
            properties: {
              foo: { type: 'string' },
              bar: { type: 'string' },
              condition: { type: 'boolean' }
            }
          },
          item: {
            type: 'object',
            $ref: '/test/complex#/$defs/common',
            unevaluatedProperties: false,
            properties: {
              name: { type: 'string' }
            }
          },
          complete: {
            type: 'object',
            unevaluatedProperties: false,
            $ref: '/test/complex#/$defs/common',
            properties: {
              items: {
                type: 'array',
                items: { $ref: '/test/complex#/$defs/item' }
              }
            },
            allOf: [{
              if: { $ref: '/test/complex#/$defs/condition/isTrue' },
              then: {
                properties: {
                  items: {
                    type: 'array',
                    items: {
                      $ref: '/test/complex#/$defs/item',
                      if: { $ref: '/test/complex#/$defs/condition/isNotFalse' },
                      then: { $ref: '/test/complex#/$defs/condition/disallowBar' }
                    }
                  }
                }
              }
            }]
          }
        }
      });

      expect(PercyConfig.validate({
        condition: true,
        foo: 'top foo',
        bar: 'top bar',
        items: [{
          name: 'item 1',
          foo: 'item 1 foo'
        }, {
          name: 'item 2',
          foo: 'item 2 foo',
          bar: 'item 2 bar'
        }, {
          name: 'item 3',
          bar: 'item 3 bar',
          condition: false
        }]
      }, '/test/complex')).toEqual([{
        path: 'bar',
        message: 'disallowed with condition enabled'
      }, {
        path: 'items[1].bar',
        message: 'disallowed with condition enabled'
      }]);
    });
    describe('.region validation', () => {
      beforeEach(() => {
        PercyConfig.addSchema({
          regions: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                elementSelector: {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    boundingBox: {
                      type: 'object',
                      additionalProperties: false,
                      properties: {
                        x: { type: 'integer' },
                        y: { type: 'integer' },
                        width: { type: 'integer' },
                        height: { type: 'integer' }
                      }
                    },
                    elementXpath: { type: 'string' },
                    elementCSS: { type: 'string' }
                  }
                },
                padding: {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    top: { type: 'integer' },
                    bottom: { type: 'integer' },
                    left: { type: 'integer' },
                    right: { type: 'integer' }
                  }
                },
                algorithm: {
                  type: 'string',
                  enum: ['standard', 'layout', 'ignore', 'intelliignore']
                },
                configuration: {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    diffSensitivity: { type: 'integer', minimum: 0 },
                    imageIgnoreThreshold: { type: 'number', minimum: 0, maximum: 1 },
                    carouselsEnabled: { type: 'boolean' },
                    bannersEnabled: { type: 'boolean' },
                    adsEnabled: { type: 'boolean' }
                  }
                },
                assertion: {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    diffIgnoreThreshold: { type: 'number', minimum: 0, maximum: 1 }
                  }
                }
              },
              required: ['algorithm']
            }
          }
        });
      });
      it('validates regions with multiple selectors', () => {
        expect(PercyConfig.validate({
          regions: [{ elementSelector: { elementCSS: '#test', elementXpath: '//test' }, algorithm: 'ignore' }]
        })).toEqual([
          {
            path: 'regions[0].elementSelector',
            message: "Exactly one of 'elementCSS', 'elementXpath', or 'boundingBox' must be provided."
          }
        ]);
      });

      it('validates regions with 1 selector', () => {
        expect(PercyConfig.validate({
          regions: [{ elementSelector: { elementCSS: '#test' }, algorithm: 'ignore' }]
        })).toEqual(undefined);
      });

      it('validates missing elementSelector', () => {
        expect(PercyConfig.validate({
          regions: [{ algorithm: 'standard', configuration: { diffSensitivity: 2 } }]
        })).toEqual(undefined);
      });

      it('validates algorithm missing elementSelector', () => {
        expect(PercyConfig.validate({
          regions: [{ algorithm: 'ignore' }]
        })).toEqual([
          {
            path: 'regions[0].elementSelector',
            message: "'elementSelector' is required when algorithm is 'ignore'."
          }
        ]);
      });

      it('validates configuration for layout algorithm', () => {
        expect(PercyConfig.validate({
          regions: [{ elementSelector: { elementCSS: '#test' }, algorithm: 'layout', configuration: {} }]
        })).toEqual([
          {
            path: 'regions[0].configuration',
            message: "Configuration is not applicable for 'layout' algorithm"
          }
        ]);
      });

      it('validates configuration for ignore algorithm', () => {
        expect(PercyConfig.validate({
          regions: [{ elementSelector: { elementCSS: '#test' }, algorithm: 'ignore', configuration: {} }]
        })).toEqual([
          {
            path: 'regions[0].configuration',
            message: "Configuration is not applicable for 'ignore' algorithm"
          }
        ]);
      });

      it('validates configuration for standard algorithm', () => {
        expect(PercyConfig.validate({
          regions: [{ elementSelector: { elementCSS: '#test' }, algorithm: 'standard' }]
        })).toEqual([
          {
            path: 'regions[0]',
            message: "Configuration is recommended for 'standard' algorithm"
          }
        ]);
      });
    });
    describe('.algorithm validation', () => {
      beforeEach(() => {
        PercyConfig.addSchema({
          algorithm: {
            type: 'string',
            enum: ['standard', 'layout', 'intelliignore']
          },
          algorithmConfiguration: {
            type: 'object',
            additionalProperties: false,
            properties: {
              diffSensitivity: { type: 'integer', minimum: 0 },
              imageIgnoreThreshold: { type: 'number', minimum: 0, maximum: 1 },
              carouselsEnabled: { type: 'boolean' },
              bannersEnabled: { type: 'boolean' },
              adsEnabled: { type: 'boolean' }
            }
          }
        });
      });

      it('validates configuration for ignore algorithm', () => {
        expect(PercyConfig.validate({
          algorithm: 'ignore'
        })).toEqual([
          {
            path: 'algorithm',
            message: 'must be equal to one of the allowed values'
          }
        ]);
      });

      it('validates algorithm should be present for algorithmConfiguration', () => {
        expect(PercyConfig.validate({
          algorithmConfiguration: { diffSensitivity: 2 }
        })).toEqual([
          {
            path: 'algorithmConfiguration',
            message: 'algorithmConfiguration needs algorithm to be passed'
          }
        ]);
      });

      it('validates algorithmConfiguration when layout algorithm is passed', () => {
        expect(PercyConfig.validate({
          algorithm: 'layout',
          algorithmConfiguration: { diffSensitivity: 2 }
        })).toEqual([
          {
            path: 'algorithmConfiguration',
            message: "algorithmConfiguration is not applicable for 'layout' algorithm"
          }
        ]);
      });

      it('validates algorithmConfiguration when standard algorithm is passed', () => {
        expect(PercyConfig.validate({
          algorithm: 'standard',
          algorithmConfiguration: { diffSensitivity: 2 }
        })).toEqual(undefined);
      });
    });

    describe('browsers validations', () => {
      beforeEach(() => {
        PercyConfig.addSchema({
          browsers: {
            type: 'array',
            items: {
              type: 'string',
              minLength: 1
            },
            onlyWeb: true
          }
        });

        delete process.env.PERCY_TOKEN;
      });

      it('can validate when browser is not an array', () => {
        expect(PercyConfig.validate({
          browsers: { chrome: 'latest' }
        })).toEqual([{ path: 'browsers', message: 'must be an array, received an object' }]);
      });

      it('can validate when browser value is not a string', () => {
        expect(PercyConfig.validate({
          browsers: [{ chrome: 'latest' }]
        })).toEqual([{ path: 'browsers[0]', message: 'must be a string, received an object' }]);
      });

      it('can validate when browser value is empty', () => {
        expect(PercyConfig.validate({
          browsers: ['chrome', '']
        })).toEqual([{ path: 'browsers[1]', message: 'must NOT have fewer than 1 characters' }]);
      });

      it('can validate when project is not web', () => {
        process.env.PERCY_TOKEN = 'auto_4567890';

        expect(PercyConfig.validate({
          browsers: ['chrome', 'firefox']
        })).toEqual([{ path: 'browsers', message: 'property only valid with Web integration.' }]);

        delete process.env.PERCY_TOKEN;
      });

      it('can validate when project is web', () => {
        // Using a non-prefix token as they are mostly all non-prefix
        // tokens are web projects
        process.env.PERCY_TOKEN = '123456789';
        expect(PercyConfig.validate({
          browsers: ['chrome', 'firefox']
        })).toEqual(undefined);

        delete process.env.PERCY_TOKEN;
      });
    });
  });

  describe('.migrate()', () => {
    beforeEach(() => {
      PercyConfig.addMigration([
        (config, util) => {
          if (config.foo) util.map('foo', 'foo.bar');
        },
        (config, util) => {
          if (config.test?.del) util.del('value');
          if (config.test?.set) util.set('test.value', config.test.set);
          if (config.test?.map) util.map('value.test', ['test', 'value']);
          if (config.test?.map2) util.map(['value', 'test'], 'test.value', v => v * 2);
          if (config.test?.dep) util.deprecate(...config.test.dep);
          util.del('test.set', 'test.map', ['test', 'map2'], ['test', 'del'], 'test.dep');
        }
      ]);
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

    it('can log deprecations and map values', () => {
      let v = { version: 2 };

      // reduce boilerplate (`foo` is used to prevent scrubbing)
      let test = (dep, value) => PercyConfig.migrate({
        test: { dep: ['value', { foo: 'bar', ...dep }] },
        value
      });

      // deprecations should log once
      expect(test({}, 1)).toEqual({ ...v, value: 1 });
      expect(test({}, 2)).toEqual({ ...v, value: 2 });
      expect(test({}, 3)).toEqual({ ...v, value: 3 });

      // test various other options
      expect(test({ type: 'test' }, 4)).toEqual({ ...v, value: 4 });
      expect(test({ until: '1.0.0' }, 5)).toEqual({ ...v, value: 5 });
      expect(test({ map: 'test' }, 6)).toEqual({ ...v, test: 6 });
      expect(test({ alt: 'See docs.' }, 7)).toEqual({ ...v, value: 7 });

      // no value, no log
      expect(test({ type: 'null' }, null)).toEqual({ ...v });

      // warns should log for each call
      expect(test({ type: 'annoying', warn: true }, 8)).toEqual({ ...v, value: 8 });
      expect(test({ type: 'annoying', warn: true }, 9)).toEqual({ ...v, value: 9 });
      expect(test({ type: 'annoying', warn: true }, 10)).toEqual({ ...v, value: 10 });

      // combination of options
      expect(test({ type: 'test', until: '1.0.0', map: 'test.value' }, 11))
        .toEqual({ ...v, test: { value: 11 } });

      // complex deprecation
      expect(PercyConfig.migrate({
        test: { dep: ['.value[0]', { map: '.a[0].b', until: '1.0.0' }] },
        value: ['c']
      })).toEqual({
        version: 2,
        a: [{ b: 'c' }]
      });

      expect(logger.stderr).toEqual([
        '[percy] Warning: The `value` option will be removed in a future release.',
        '[percy] Warning: The test option `value` will be removed in a future release.',
        '[percy] Warning: The `value` option will be removed in 1.0.0.',
        '[percy] Warning: The `value` option will be removed in a future release. Use `test` instead.',
        '[percy] Warning: The `value` option will be removed in a future release. See docs.',
        '[percy] Warning: The annoying option `value` will be removed in a future release.',
        '[percy] Warning: The annoying option `value` will be removed in a future release.',
        '[percy] Warning: The annoying option `value` will be removed in a future release.',
        '[percy] Warning: The test option `value` will be removed in 1.0.0. Use `test.value` instead.',
        '[percy] Warning: The `value[0]` option will be removed in 1.0.0. Use `a[0].b` instead.'
      ]);
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

    it('can register migrations for specific schemas', () => {
      PercyConfig.addSchema([
        { $id: '/a', type: 'object' },
        { $id: '/b', type: 'object' }
      ]);

      PercyConfig.addMigration([
        (c, { set }) => set('foo', 1),
        (c, { set }) => set('bar', 2)
      ], '/a');

      PercyConfig.addMigration({
        '/a': (c, { set }) => set('baz', 3),
        '/b': (c, { set }) => set('xyzzy', -1)
      });

      expect(PercyConfig.migrate({}, '/a'))
        .toEqual({ foo: 1, bar: 2, baz: 3 });
      expect(PercyConfig.migrate({}, '/b'))
        .toEqual({ xyzzy: -1 });
      expect(PercyConfig.migrate({}, '/c'))
        .toEqual({});
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

      fs.writeFileSync('.percy.yml', [
        'version: 2',
        'test:',
        '  value: percy'
      ].join('\n'));

      fs.writeFileSync('.bar.yml', [
        'version: 2',
        'test:',
        '  value: bar'
      ].join('\n'));

      fs.writeFileSync('.defaults.yml', [
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

    it('can search a provided directory for a config file', async () => {
      let path = await import('path');
      let filepath = path.join('config', '.percy.yml');
      logger.loglevel('debug');

      fs.mkdirSync('config');
      fs.writeFileSync(filepath, [
        'version: 2',
        'test:',
        '  value: config/percy'
      ].join('\n'));

      expect(PercyConfig.load({
        path: './config'
      })).toEqual({
        version: 2,
        test: { value: 'config/percy' }
      });

      expect(logger.stdout).toEqual([]);
      expect(logger.stderr).toContain(
        `[percy:config] Found config file: ${filepath}`
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
      fs.writeFileSync('.cached.yml', 'version: 2');
      PercyConfig.load({ path: '.cached.yml' });
      PercyConfig.load({ path: '.cached.yml' });
      PercyConfig.load({ path: '.cached.yml' });
      expect(fs.readFileSync).toHaveBeenCalledTimes(1);
    });

    it('reloads cached config files when `reload` is true', () => {
      fs.writeFileSync('.cached.yml', 'version: 2');
      PercyConfig.load({ path: '.cached.yml' });
      PercyConfig.load({ path: '.cached.yml' });
      PercyConfig.load({ path: '.cached.yml', reload: true });
      expect(fs.readFileSync).toHaveBeenCalledTimes(2);
    });

    it('logs when a config file cannot be found', () => {
      logger.loglevel('debug');

      expect(PercyConfig.load({
        path: '.404.yml'
      })).toEqual({
        version: 2,
        test: { value: 'foo' }
      });

      expect(logger.stdout).toEqual([]);
      expect(logger.stderr).toEqual([
        '[percy:config] Config file not found'
      ]);
    });

    it('logs when no config file can be found', async () => {
      let { explorer } = await import('../src/load.js');
      spyOn(explorer, 'search').and.returnValue(null);

      expect(PercyConfig.load({ print: true })).toEqual({
        version: 2,
        test: { value: 'foo' }
      });

      expect(logger.stderr).toEqual([]);
      expect(logger.stdout).toEqual([
        '[percy] Config file not found'
      ]);
    });

    it('logs when a config directory does not exist', async () => {
      expect(PercyConfig.load({
        path: 'no-configs-here/',
        print: true
      })).toEqual({
        version: 2,
        test: { value: 'foo' }
      });

      expect(logger.stderr).toEqual([]);
      expect(logger.stdout).toEqual([
        '[percy] Config file not found'
      ]);
    });

    it('optionally bails when a config file cannot be found', () => {
      logger.loglevel('debug');

      expect(PercyConfig.load({
        path: '.404.yml',
        bail: true
      })).toBeUndefined();

      expect(logger.stdout).toEqual([]);
      expect(logger.stderr).toEqual([
        '[percy:config] Config file not found'
      ]);
    });

    it('logs when failing to load or parse the config file', () => {
      fs.writeFileSync('.error.yml', '');
      fs.readFileSync.and.throwError(new Error('test'));

      expect(PercyConfig.load({
        path: '.error.yml',
        print: true
      })).toEqual({
        version: 2,
        test: { value: 'foo' }
      });

      expect(logger.stdout).toEqual([]);
      expect(logger.stderr).toEqual([
        jasmine.stringMatching('\\[percy] Error: test')
      ]);
    });

    it('optionally bails when failing to load or parse the config file', () => {
      fs.writeFileSync('.error.yml', '');
      fs.readFileSync.and.throwError(new Error('test'));
      logger.loglevel('debug');

      expect(PercyConfig.load({
        path: '.error.yml',
        bail: true
      })).toBeUndefined();

      expect(logger.stdout).toEqual([]);
      expect(logger.stderr).toEqual([
        jasmine.stringMatching('\\[percy:config] Error: test')
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

      fs.writeFileSync('.foo.yml', [
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
      fs.writeFileSync('.no-version.yml', 'test:\n  value: no-version');
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
      fs.writeFileSync('.bad-version.yml', 'version: 3\ntest:\n  value: bad-version');
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
      fs.writeFileSync('.old-version.yml', 'version: 1\nvalue: old-value');
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
      fs.writeFileSync('.invalid.yml', 'version: 2\nfoo: bar');
      logger.loglevel('debug');

      PercyConfig.addSchema({
        obj: {
          type: 'object',
          unevaluatedProperties: false,
          properties: {
            foo: { type: 'string' }
          }
        }
      });

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
      fs.writeFileSync('.invalid.yml', 'version: 2\nfoo: bar');
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

    it('removes circular references', () => {
      let foo = { bar: 'baz' };
      foo.foo = foo;

      expect(PercyConfig.normalize(foo))
        .toEqual({ bar: 'baz' });
    });

    it('does not remove all empty "objects"', () => {
      let config = {
        regex: /foobar/,
        date: new Date(),
        foo: new (class {})(),
        object: {},
        array: []
      };

      expect(PercyConfig.normalize(config))
        .toEqual({
          // referential equality
          regex: config.regex,
          date: config.date,
          foo: config.foo
        });
    });

    it('converts keys to camelCase', () => {
      expect(PercyConfig.normalize({
        'foo-bar': 'baz',
        foo: { bar_baz: 'qux' },
        'foo_bar-baz': 'qux',
        'Bar BAZ qux': 'xyzzy',
        'percy-css': '',
        'enable-javascript': false,
        'disable-shadow-dom': true,
        'cli-enable-javascript': true,
        'ignore-region-xpaths': [''],
        'enable-layout': false,
        'full-page': false
      })).toEqual({
        fooBar: 'baz',
        foo: { barBaz: 'qux' },
        fooBarBaz: 'qux',
        barBazQux: 'xyzzy',
        percyCSS: '',
        enableJavaScript: false,
        disableShadowDOM: true,
        cliEnableJavaScript: true,
        ignoreRegionXpaths: [''],
        enableLayout: false,
        fullPage: false
      });
    });

    it('can convert keys to kebab-case', () => {
      expect(PercyConfig.normalize({
        'foo-bar': 'baz',
        foo: { bar_baz: 'qux' },
        fooBar_baz: ['qux'],
        percyCSS: '',
        enableJavaScript: false,
        disableShadowDOM: true,
        cliEnableJavaScript: true,
        ignoreRegionXpaths: [''],
        enableLayout: false,
        fullPage: false
      }, { kebab: true })).toEqual({
        'foo-bar': 'baz',
        foo: { 'bar-baz': 'qux' },
        'foo-bar-baz': ['qux'],
        'percy-css': '',
        'enable-javascript': false,
        'disable-shadow-dom': true,
        'cli-enable-javascript': true,
        'ignore-region-xpaths': [''],
        'enable-layout': false,
        'full-page': false
      });
    });

    it('can convert keys to snake_case', () => {
      expect(PercyConfig.normalize({
        'foo-bar': 'baz',
        foo: { bar_baz: 'qux' },
        fooBar_baz: ['qux'],
        percyCSS: '',
        enableJavaScript: false,
        disableShadowDOM: true,
        cliEnableJavaScript: true,
        ignoreRegionXpaths: [''],
        enableLayout: false,
        fullPage: false
      }, { snake: true })).toEqual({
        foo_bar: 'baz',
        foo: { bar_baz: 'qux' },
        foo_bar_baz: ['qux'],
        percy_css: '',
        enable_javascript: false,
        disable_shadow_dom: true,
        cli_enable_javascript: true,
        ignore_region_xpaths: [''],
        enable_layout: false,
        full_page: false
      });
    });

    it('skips normalizing properties of class instances', () => {
      expect(PercyConfig.normalize({
        inst: new (class { 'don_t-doThis' = 'plz' })(),
        'why_mix-case': 'no'
      })).toEqual({
        inst: jasmine.objectContaining({ 'don_t-doThis': 'plz' }),
        whyMixCase: 'no'
      });
    });

    it('skips normalizing properties as determined by their schema', () => {
      // this schema is purposefully complex to generate better coverage
      PercyConfig.addSchema({
        $id: '/test',
        type: 'object',
        properties: {
          fooOne: {
            type: 'object',
            normalize: false
          },
          barTwo: {
            type: 'array',
            normalize: false,
            items: {
              type: 'object'
            }
          },
          bazThree: {
            type: 'array',
            items: {
              oneOf: [{
                type: 'string'
              }, {
                type: 'object',
                additionalProperties: false,
                properties: {
                  quxFour: { type: 'number' }
                }
              }, {
                type: 'array',
                items: [
                  { type: 'boolean' },
                  { $ref: '#/properties/barTwo/items' }
                ]
              }, {
                type: 'object',
                normalize: false
              }]
            }
          }
        }
      });

      expect(PercyConfig.normalize({
        'foo-one': {
          'Foo-Bar-Baz': 123
        },
        foo_one: {
          'Baz-Bar-Foo': 321
        },
        bar_two: [
          { foo_bar: '1_2' },
          { bar_baz: '2_3' }
        ],
        baz_three: [
          { 'qux-four': 4 },
          { 'baz-foo=bar': '3-1=2' },
          [true, { 'qux-four': 8 }],
          'xyzzy'
        ]
      }, '/test')).toEqual({
        fooOne: {
          'Foo-Bar-Baz': 123,
          'Baz-Bar-Foo': 321
        },
        barTwo: [
          { foo_bar: '1_2' },
          { bar_baz: '2_3' }
        ],
        bazThree: [
          { quxFour: 4 },
          { 'baz-foo=bar': '3-1=2' },
          [true, { quxFour: 8 }],
          'xyzzy'
        ]
      });
    });

    it('skips normalizing properties when skip returns true', () => {
      expect(PercyConfig.normalize({
        'fix-this_property': 1,
        'skip-this_property': 2
      }, {
        skip: path => path[0].startsWith('skip')
      })).toEqual({
        fixThisProperty: 1,
        'skip-this_property': 2
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
