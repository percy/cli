import path from 'path';
import { logger, mockConfig } from './helpers';
import PercyConfig from '@percy/config';
import validate from '../src/validate';

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
    await validate();

    expect(logger.stderr).toEqual([]);
    expect(logger.stdout).toEqual([
      '[percy] Found config file: .percy.yml',
      '[percy] Using config:\n' + [
        '{',
        '  version: 2,',
        '  test: {',
        '    value: \'percy\'',
        '  }',
        '}'
      ].join('\n')
    ]);
  });

  it('logs debug info for a provided valid config file', async () => {
    let filename = path.join('.config', 'percy.yml');
    mockConfig(filename, 'version: 2\ntest:\n  value: config');
    await validate([filename]);

    expect(logger.stderr).toEqual([]);
    expect(logger.stdout).toEqual([
      `[percy] Found config file: ${filename}`,
      '[percy] Using config:\n' + [
        '{',
        '  version: 2,',
        '  test: {',
        '    value: \'config\'',
        '  }',
        '}'
      ].join('\n')
    ]);
  });

  it('errors with invalid or unkown config options', async () => {
    mockConfig('.invalid.yml', 'version: 2\ntest:\n  value: false\nbar: baz');
    await expectAsync(validate(['.invalid.yml'])).toBeRejected();

    expect(logger.stdout).toEqual([
      '[percy] Found config file: .invalid.yml'
    ]);
    expect(logger.stderr).toEqual([
      '[percy] Invalid config:',
      '[percy] - bar: unknown property',
      '[percy] - test.value: must be a string, received a boolean'
    ]);
  });

  it('errors when a config cannot be found', async () => {
    await expectAsync(validate(['.404.yml'])).toBeRejected();

    expect(logger.stdout).toEqual([]);
    expect(logger.stderr).toEqual([
      '[percy] Error: Config file not found'
    ]);
  });
});
