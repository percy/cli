import path from 'path';
import { PercyConfig } from '@percy/cli-command';
import { fs, logger, setupTest } from '@percy/cli-command/test/helpers';
import { validate } from '@percy/cli-config';

describe('percy config:validate', () => {
  beforeEach(async () => {
    await setupTest({ resetConfig: true });

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
    fs.writeFileSync('.percy.yml', 'version: 2\ntest:\n  value: percy');
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
    fs.$vol.fromJSON({ [filename]: 'version: 2\ntest:\n  value: config' });
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

  it('errors with invalid or unknown config options', async () => {
    fs.writeFileSync('.invalid.yml', 'version: 2\ntest:\n  value: false\nbar: baz');
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
