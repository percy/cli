import expect from 'expect';
import { logger, getMockConfig } from './helpers';
import { Create } from '../src/commands/config/create';
import PercyConfig from '@percy/config';

describe('percy config:create', () => {
  it('creates a .percy.yml config file by default', async () => {
    await Create.run([]);
    expect(logger.stderr).toEqual([]);
    expect(logger.stdout).toEqual(['[percy] Created Percy config: .percy.yml\n']);
    expect(getMockConfig('.percy.yml')).toBe(PercyConfig.stringify('yaml'));
  });

  it('can create a .percyrc config file', async () => {
    await Create.run(['--rc']);
    expect(logger.stderr).toEqual([]);
    expect(logger.stdout).toEqual(['[percy] Created Percy config: .percyrc\n']);
    expect(getMockConfig('.percyrc')).toBe(PercyConfig.stringify('yaml'));
  });

  it('can create a .percy.yaml config file', async () => {
    await Create.run(['--yaml']);
    expect(logger.stderr).toEqual([]);
    expect(logger.stdout).toEqual(['[percy] Created Percy config: .percy.yaml\n']);
    expect(getMockConfig('.percy.yaml')).toBe(PercyConfig.stringify('yaml'));
  });

  it('can create a .percy.yml config file', async () => {
    await Create.run(['--yml']);
    expect(logger.stderr).toEqual([]);
    expect(logger.stdout).toEqual(['[percy] Created Percy config: .percy.yml\n']);
    expect(getMockConfig('.percy.yml')).toBe(PercyConfig.stringify('yaml'));
  });

  it('can create a .percy.json config file', async () => {
    await Create.run(['--json']);
    expect(logger.stderr).toEqual([]);
    expect(logger.stdout).toEqual(['[percy] Created Percy config: .percy.json\n']);
    expect(getMockConfig('.percy.json')).toBe(PercyConfig.stringify('json'));
  });

  it('can create a .percy.js config file', async () => {
    await Create.run(['--js']);
    expect(logger.stderr).toEqual([]);
    expect(logger.stdout).toEqual(['[percy] Created Percy config: .percy.js\n']);
    expect(getMockConfig('.percy.js')).toBe(PercyConfig.stringify('js'));
  });

  it('can create specific config files', async () => {
    await Create.run(['config/percy.config.js']);
    expect(logger.stderr).toEqual([]);
    expect(logger.stdout).toEqual(['[percy] Created Percy config: config/percy.config.js\n']);
    expect(getMockConfig('config/percy.config.js')).toBe(PercyConfig.stringify('js'));
  });

  it('logs an error and exits when the filetype is unsupported', async () => {
    await expect(Create.run(['config/percy.config.php'])).rejects.toThrow('EEXIT: 1');
    expect(logger.stdout).toEqual([]);
    expect(logger.stderr).toEqual(['[percy] Unsupported filetype: php\n']);
  });

  it('logs an error and exits when the config file already exists', async () => {
    await Create.run(['.percy.yml']);
    logger.clear();

    await expect(Create.run(['.percy.yml'])).rejects.toThrow('EEXIT: 1');

    expect(logger.stdout).toEqual([]);
    expect(logger.stderr).toEqual(['[percy] Percy config already exists: .percy.yml\n']);
  });
});
