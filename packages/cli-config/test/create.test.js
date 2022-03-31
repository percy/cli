import path from 'path';
import { PercyConfig } from '@percy/cli-command';
import { fs, logger, setupTest } from '@percy/cli-command/test/helpers';
import create from '../src/create.js';

describe('percy config:create', () => {
  beforeEach(async () => {
    await setupTest();
  });

  it('creates a .percy.yml config file by default', async () => {
    await create();
    expect(logger.stderr).toEqual([]);
    expect(logger.stdout).toEqual(['[percy] Created Percy config: .percy.yml']);
    expect(fs.readFileSync('.percy.yml', 'utf-8')).toBe(PercyConfig.stringify('yaml'));
  });

  it('can create a .percyrc config file', async () => {
    await create(['--rc']);
    expect(logger.stderr).toEqual([]);
    expect(logger.stdout).toEqual(['[percy] Created Percy config: .percyrc']);
    expect(fs.readFileSync('.percyrc', 'utf-8')).toBe(PercyConfig.stringify('yaml'));
  });

  it('can create a .percy.yaml config file', async () => {
    await create(['--yaml']);
    expect(logger.stderr).toEqual([]);
    expect(logger.stdout).toEqual(['[percy] Created Percy config: .percy.yaml']);
    expect(fs.readFileSync('.percy.yaml', 'utf-8')).toBe(PercyConfig.stringify('yaml'));
  });

  it('can create a .percy.yml config file', async () => {
    await create(['--yml']);
    expect(logger.stderr).toEqual([]);
    expect(logger.stdout).toEqual(['[percy] Created Percy config: .percy.yml']);
    expect(fs.readFileSync('.percy.yml', 'utf-8')).toBe(PercyConfig.stringify('yaml'));
  });

  it('can create a .percy.json config file', async () => {
    await create(['--json']);
    expect(logger.stderr).toEqual([]);
    expect(logger.stdout).toEqual(['[percy] Created Percy config: .percy.json']);
    expect(fs.readFileSync('.percy.json', 'utf-8')).toBe(PercyConfig.stringify('json'));
  });

  it('can create a .percy.js config file', async () => {
    await create(['--js']);
    expect(logger.stderr).toEqual([]);
    expect(logger.stdout).toEqual(['[percy] Created Percy config: .percy.js']);
    expect(fs.readFileSync('.percy.js', 'utf-8')).toBe(PercyConfig.stringify('js'));
  });

  it('can create specific config files', async () => {
    let filename = path.join('.config', 'percy.config.js');
    await create([filename]);

    expect(logger.stderr).toEqual([]);
    expect(logger.stdout).toEqual([`[percy] Created Percy config: ${filename}`]);
    expect(fs.readFileSync(filename, 'utf-8')).toBe(PercyConfig.stringify('js'));
  });

  it('errors when the filetype is unsupported', async () => {
    await expectAsync(
      create([path.join('.config', 'percy.config.php')])
    ).toBeRejected();

    expect(logger.stdout).toEqual([]);
    expect(logger.stderr).toEqual(['[percy] Error: Unsupported filetype: php']);
  });

  it('errors when the config file already exists', async () => {
    await create(['.percy.yml']);
    logger.reset();

    await expectAsync(create(['.percy.yml'])).toBeRejected();

    expect(logger.stdout).toEqual([]);
    expect(logger.stderr).toEqual(['[percy] Error: Percy config already exists: .percy.yml']);
  });
});
