import path from 'path';
import { logger, mockConfig } from './helpers';
import { Validate } from '../src/commands/config/validate';
import PercyConfig from '@percy/config';

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

  afterEach(() => {
    PercyConfig.cache.clear();
    PercyConfig.resetSchema();
  });

  it('logs debug info for a valid config file', async () => {
    mockConfig('.percy.yml', 'version: 2\ntest:\n  value: percy');
    await Validate.run([]);

    expect(logger.stderr).toEqual([]);
    expect(logger.stdout).toEqual([
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
    let filename = path.join('.config', 'percy.yml');
    mockConfig(filename, 'version: 2\ntest:\n  value: config');
    await Validate.run([filename]);

    expect(logger.stderr).toEqual([]);
    expect(logger.stdout).toEqual([
      `[percy] Found config file: ${filename}\n`,
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
    mockConfig('.invalid.yml', 'version: 2\ntest:\n  value: false\nbar: baz');
    await expectAsync(Validate.run(['.invalid.yml'])).toBeRejectedWithError('EEXIT: 1');

    expect(logger.stdout).toEqual([
      '[percy] Found config file: .invalid.yml\n'
    ]);
    expect(logger.stderr).toEqual([
      '[percy] Invalid config:\n',
      '[percy] - bar: unknown property\n',
      '[percy] - test.value: should be a string, received a boolean\n'
    ]);
  });
});
