import expect from 'expect';
import { stdio, mockConfig, getMockConfig } from './helpers';
import { Migrate } from '../src/commands/config/migrate';

describe('percy config:migrate', () => {
  beforeEach(() => {
    mockConfig('.percy.yml', 'version: 1\n');
  });

  it('by default, renames the config before writing', async () => {
    await stdio.capture(() => Migrate.run([]));

    expect(stdio[2]).toHaveLength(0);
    expect(stdio[1]).toEqual([
      '[percy] Found config file: .percy.yml\n',
      '[percy] Migrating config file...\n',
      '[percy] Config file migrated!\n'
    ]);

    expect(getMockConfig('.percy.old.yml')).toContain('version: 1');
    expect(getMockConfig('.percy.yml')).toContain('version: 2');
  });

  it('prints config with the --dry-run flag', async () => {
    await stdio.capture(() => Migrate.run(['--dry-run']));
    expect(getMockConfig('.percy.yml')).toContain('version: 1');
    expect(stdio[2]).toHaveLength(0);
    expect(stdio[1]).toEqual([
      '[percy] Found config file: .percy.yml\n',
      '[percy] Migrating config file...\n',
      '[percy] Config file migrated!\n',
      '\nversion: 2\n'
    ]);
  });

  it('works with rc configs', async () => {
    mockConfig('.percyrc', 'version: 1\n');
    await stdio.capture(() => Migrate.run(['.percyrc']));
    expect(getMockConfig('.percyrc')).toEqual('version: 2\n');
  });

  it('works with package.json configs', async () => {
    let json = o => JSON.stringify(o, null, 2);

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

    await stdio.capture(() => Migrate.run(['package.json']));

    expect(getMockConfig('package.json')).toEqual(
      json({ ...pkg, percy: { version: 2 } })
    );
  });

  it('can convert between config types', async () => {
    await stdio.capture(() => Migrate.run(['.percy.yml', '.percy.js']));
    expect(getMockConfig('.percy.js'))
      .toEqual('module.exports = {\n  version: 2\n}');
  });

  it('errors and exits when a config cannot be found', async () => {
    await expect(stdio.capture(() => (
      Migrate.run(['.config/percy.yml'])
    ))).rejects.toThrow('EEXIT: 1');

    expect(stdio[1]).toHaveLength(0);
    expect(stdio[2]).toEqual([
      '[percy] Config file not found\n'
    ]);
  });

  it('errors and exits when a config cannot be parsed', async () => {
    mockConfig('.config/percy.yml', () => {
      throw new Error('test');
    });

    await expect(stdio.capture(() => (
      Migrate.run(['.config/percy.yml'])
    ))).rejects.toThrow('EEXIT: 1');

    expect(stdio[1]).toHaveLength(0);
    expect(stdio[2]).toEqual([
      '[percy] Failed to load or parse config file\n',
      '[percy] Error: test\n'
    ]);
  });

  it('warns when a config is already the latest version', async () => {
    mockConfig('.percy.yml', 'version: 2\n');
    await stdio.capture(() => Migrate.run([]));

    expect(stdio[2]).toHaveLength(0);
    expect(stdio[1]).toEqual([
      '[percy] Found config file: .percy.yml\n',
      '[percy] Config is already the latest version\n'
    ]);

    expect(getMockConfig('.percy.old.yml')).toBeUndefined();
  });

  it('migrates v1 config', async () => {
    mockConfig('.percy.yml', [
      'version: 1',
      'snapshot:',
      '  widths: [1000]',
      '  min-height: 1000',
      '  enable-javascript: true',
      '  percy-css: "iframe { display: none; }"',
      'agent:',
      '  asset-discovery:',
      '    allowed-hostnames:',
      '      - cdn.example.com',
      '    request-headers:',
      '      Authorization: Basic dXNlcm5hbWU6cGFzc3dvcmQ=',
      '    network-idle-timeout: 500',
      '    cache-responses: false',
      '    page-pool-size-min: 10',
      '    page-pool-size-max: 50',
      'static-snapshots:',
      '  path: _site/',
      '  base-url: /blog/',
      '  snapshot-files: "**/*.html"',
      '  ignore-files: "**/*.htm"',
      'image-snapshots:',
      '  path: _images/',
      '  files: "**/*.html"',
      '  ignore: "**/*.htm"\n'
    ].join('\n'));

    await stdio.capture(() => Migrate.run([]));

    expect(getMockConfig('.percy.yml')).toEqual([
      'version: 2',
      'snapshot:',
      '  widths:',
      '    - 1000',
      '  min-height: 1000',
      '  enable-javascript: true',
      '  percy-css: "iframe { display: none; }"',
      '  request-headers:',
      '    Authorization: Basic dXNlcm5hbWU6cGFzc3dvcmQ=',
      'discovery:',
      '  allowed-hostnames:',
      '    - cdn.example.com',
      '  network-idle-timeout: 500',
      '  concurrency: 50',
      '  disable-asset-cache: true',
      'upload:',
      '  files: "**/*.html"',
      '  ignore: "**/*.htm"',
      'static:',
      '  base-url: /blog/',
      '  files: "**/*.html"',
      '  ignore: "**/*.htm"\n'
    ].join('\n'));
  });
});
