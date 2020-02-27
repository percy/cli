import expect from 'expect';
import { mockConfig, stdio } from './helpers';
import { Validate } from '../src/commands/config/validate';
import PercyConfig from '../src';

describe('percy config:validate', () => {
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

  it('logs debug info for a valid config file', async () => {
    mockConfig('.percy.yml', () => ({ version: 2, test: { value: 'percy' } }));
    await stdio.capture(() => Validate.run([]));

    expect(stdio[2]).toHaveLength(0);
    expect(stdio[1]).toEqual([
      '[percy] Found config file: .percy.yml\n',
      '[percy] Using config:\n' + [
        '{',
        '  version: 2,',
        '  test: {',
        '    value: \'percy\'',
        '  }',
        '}\n'
      ].join('\n')
    ]);
  });

  it('logs debug info for a provided valid config file', async () => {
    mockConfig('config/percy.js', () => ({ version: 2, test: { value: 'config' } }));
    await stdio.capture(() => Validate.run(['config/percy.js']));

    expect(stdio[2]).toHaveLength(0);
    expect(stdio[1]).toEqual([
      '[percy] Found config file: config/percy.js\n',
      '[percy] Using config:\n' + [
        '{',
        '  version: 2,',
        '  test: {',
        '    value: \'config\'',
        '  }',
        '}\n'
      ].join('\n')
    ]);
  });

  it('logs an error and exits for invalid or unkown config options', async () => {
    mockConfig('.invalid.js', () => ({ version: 2, test: { value: false }, bar: 'baz' }));
    await expect(stdio.capture(() => Validate.run([]))).rejects.toThrow('EEXIT: 1');

    expect(stdio[2]).toHaveLength(0);
    expect(stdio[1]).toEqual([
      '[percy] Found config file: .invalid.js\n',
      '[percy] Invalid config:\n',
      '[percy] - unknown property \'bar\'\n',
      '[percy] - \'test.value\' should be a string, received a boolean\n'
    ]);
  });
});
