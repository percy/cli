import path from 'path';
import PercyConfig from '@percy/config';
import { logger, mockConfig, getMockConfig } from './helpers';
import { Migrate } from '../src/commands/config/migrate';

describe('percy config:migrate', () => {
  beforeEach(() => {
    mockConfig('.percy.yml', 'version: 1\n');
    PercyConfig.addMigration((input, set) => {
      if (input.migrate != null) set('migrated', input.migrate.replace('old', 'new'));
    });
  });

  afterEach(() => {
    PercyConfig.clearMigrations();
  });

  it('by default, renames the config before writing', async () => {
    await Migrate.run([]);

    expect(logger.stderr).toEqual([]);
    expect(logger.stdout).toEqual([
      '[percy] Found config file: .percy.yml\n',
      '[percy] Migrating config file...\n',
      '[percy] Config file migrated!\n'
    ]);

    expect(getMockConfig('.percy.old.yml')).toContain('version: 1');
    expect(getMockConfig('.percy.yml')).toContain('version: 2');
  });

  it('prints config with the --dry-run flag', async () => {
    await Migrate.run(['--dry-run']);
    expect(getMockConfig('.percy.yml')).toContain('version: 1');
    expect(logger.stderr).toEqual([]);
    expect(logger.stdout).toEqual([
      '[percy] Found config file: .percy.yml\n',
      '[percy] Migrating config file...\n',
      '[percy] Config file migrated!\n',
      '\nversion: 2\n'
    ]);
  });

  it('works with rc configs', async () => {
    mockConfig('.percyrc', 'version: 1\n');
    await Migrate.run(['.percyrc']);
    expect(getMockConfig('.percyrc')).toEqual('version: 2\n');
  });

  it('works with package.json configs', async () => {
    let json = o => JSON.stringify(o, null, 2) + '\n';

    let pkg = {
      name: 'some-package',
      version: '0.1.0',
      scripts: {},
      percy: { version: 1 },
      dependencies: {},
      devDependencies: {}
    };

    // this is mocked and reflected in `getMockConfig`
    require('fs').writeFileSync('package.json', json(pkg));

    await Migrate.run(['package.json']);

    expect(getMockConfig('package.json')).toEqual(
      json({ ...pkg, percy: { version: 2 } })
    );
  });

  it('can convert between config types', async () => {
    await Migrate.run(['.percy.yml', '.percy.js']);
    expect(getMockConfig('.percy.js'))
      .toEqual('module.exports = {\n  version: 2\n}\n');
  });

  it('errors and exits when a config cannot be found', async () => {
    await expectAsync(Migrate.run([path.join('.config', 'percy.yml')])).toBeRejectedWithError('EEXIT: 1');

    expect(logger.stdout).toEqual([]);
    expect(logger.stderr).toEqual([
      '[percy] Config file not found\n'
    ]);
  });

  it('errors and exits when a config cannot be parsed', async () => {
    let filename = path.join('.config', 'percy.yml');

    mockConfig(filename, () => {
      throw new Error('test');
    });

    await expectAsync(Migrate.run([filename])).toBeRejectedWithError('EEXIT: 1');

    expect(logger.stdout).toEqual([]);
    expect(logger.stderr).toEqual([
      '[percy] Error: test\n'
    ]);
  });

  it('warns when a config is already the latest version', async () => {
    mockConfig('.percy.yml', 'version: 2\n');
    await Migrate.run([]);

    expect(logger.stdout).toEqual([
      '[percy] Found config file: .percy.yml\n'
    ]);
    expect(logger.stderr).toEqual([
      '[percy] Config is already the latest version\n'
    ]);

    expect(getMockConfig('.percy.old.yml')).toBeUndefined();
  });

  it('runs registered migrations on the config', async () => {
    mockConfig('.percy.yml', [
      'version: 1',
      'migrate: old-value'
    ].join('\n'));

    await Migrate.run([]);

    expect(getMockConfig('.percy.yml')).toEqual([
      'version: 2',
      'migrated: new-value'
    ].join('\n') + '\n');
  });
});
