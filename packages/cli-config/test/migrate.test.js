import path from 'path';
import { PercyConfig } from '@percy/cli-command';
import { fs, logger, setupTest } from '@percy/cli-command/test/helpers';
import migrate from '../src/migrate';

describe('percy config:migrate', () => {
  beforeEach(async () => {
    await setupTest({
      resetConfig: true,
      filesystem: { '.percy.yml': 'version: 1\n' }
    });

    PercyConfig.addMigration((config, util) => {
      if (config.migrate) util.map('migrate', 'migrated', v => v.replace('old', 'new'));
    });
  });

  it('by default, renames the config before writing', async () => {
    await migrate();

    expect(logger.stderr).toEqual([]);
    expect(logger.stdout).toEqual([
      '[percy] Found config file: .percy.yml',
      '[percy] Migrating config file...',
      '[percy] Config file migrated!'
    ]);

    expect(fs.readFileSync('.percy.old.yml', 'utf-8')).toContain('version: 1');
    expect(fs.readFileSync('.percy.yml', 'utf-8')).toContain('version: 2');
  });

  it('prints config with the --dry-run flag', async () => {
    await migrate(['--dry-run']);

    expect(fs.readFileSync('.percy.yml', 'utf-8')).toContain('version: 1');
    expect(logger.stderr).toEqual([]);
    expect(logger.stdout).toEqual([
      '[percy] Found config file: .percy.yml',
      '[percy] Migrating config file...',
      '[percy] Config file migrated!',
      '\nversion: 2'
    ]);
  });

  it('works with rc configs', async () => {
    fs.writeFileSync('.percyrc', 'version: 1\n');
    await migrate(['.percyrc']);

    expect(fs.readFileSync('.percyrc', 'utf-8')).toEqual('version: 2\n');
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

    fs.writeFileSync('package.json', json(pkg));
    await migrate(['package.json']);

    expect(fs.readFileSync('package.json', 'utf-8')).toEqual(
      json({ ...pkg, percy: { version: 2 } })
    );
  });

  it('can convert between config types', async () => {
    await migrate(['.percy.yml', '.percy.js']);

    expect(fs.readFileSync('.percy.js', 'utf-8'))
      .toEqual('module.exports = {\n  version: 2\n}\n');
  });

  it('errors when a config cannot be found', async () => {
    await expectAsync(
      migrate([path.join('.config', 'percy.yml')])
    ).toBeRejected();

    expect(logger.stdout).toEqual([]);
    expect(logger.stderr).toEqual([
      '[percy] Error: Config file not found'
    ]);
  });

  it('errors when a config cannot be parsed', async () => {
    fs.writeFileSync('.error.yml', '');
    fs.readFileSync.and.throwError(new Error('test'));

    await expectAsync(migrate(['.error.yml'])).toBeRejected();

    expect(logger.stdout).toEqual([]);
    expect(logger.stderr).toEqual([
      '[percy] Error: test'
    ]);
  });

  it('warns when a config is already the latest version', async () => {
    fs.writeFileSync('.percy.yml', 'version: 2\n');
    await migrate();

    expect(logger.stdout).toEqual([
      '[percy] Found config file: .percy.yml'
    ]);
    expect(logger.stderr).toEqual([
      '[percy] Config is already the latest version'
    ]);

    expect(fs.existsSync('.percy.old.yml')).toBe(false);
  });

  it('runs registered migrations on the config', async () => {
    fs.writeFileSync('.percy.yml', [
      'version: 1',
      'migrate: old-value'
    ].join('\n'));

    await migrate();

    expect(fs.readFileSync('.percy.yml', 'utf-8')).toEqual([
      'version: 2',
      'migrated: new-value'
    ].join('\n') + '\n');
  });
});
