import path from 'path';
import { logger, mockfs, fs } from '@percy/cli-command/test/helpers';
import { mockModuleCommands, mockPnpCommands, mockLegacyCommands } from './helpers.js';
import { importCommands } from '../src/commands.js';

describe('CLI commands', () => {
  beforeEach(async () => {
    await logger.mock({ level: 'debug' });
    await mockfs({ $modules: true });
  });

  describe('from a project', () => {
    it('imports the project command', async () => {
      fs.writeFileSync('command.js', 'module.exports.name = "foobar"');
      fs.writeFileSync('package.json', '{ "@percy/cli": { "commands": ["./command.js"] } }');

      await expectAsync(importCommands()).toBeResolvedTo([
        jasmine.objectContaining({ name: 'foobar' })
      ]);

      expect(logger.stdout).toEqual([]);
      expect(logger.stderr).toEqual([]);
    });
  });

  describe('from node_modules', () => {
    const mockCmds = {
      '@percy/cli-exec': { name: 'exec' },
      '@percy/cli-config': { name: 'config' },
      '@percy/storybook': { name: 'storybook' },
      '@percy/core': null,
      '@percy/cli': null,
      'percy-cli-custom': { name: 'custom' },
      'percy-cli-other': null,
      'other-dep': null
    };

    const expectedCmds = [
      jasmine.objectContaining({ name: 'config' }),
      jasmine.objectContaining({ name: 'custom' }),
      jasmine.objectContaining({ name: 'exec' }),
      jasmine.objectContaining({ name: 'storybook' })
    ];

    it('imports from dependencies', async () => {
      await mockModuleCommands(path.resolve('.'), mockCmds);
      await expectAsync(importCommands()).toBeResolvedTo(expectedCmds);
      expect(logger.stdout).toEqual([]);
      expect(logger.stderr).toEqual([]);
    });

    it('imports from a parent directory', async () => {
      await mockModuleCommands(path.resolve('../..'), mockCmds);
      await expectAsync(importCommands()).toBeResolvedTo(expectedCmds);
      expect(logger.stdout).toEqual([]);
      expect(logger.stderr).toEqual([]);
    });

    it('imports from the current project', async () => {
      await mockModuleCommands(process.cwd(), mockCmds);
      await expectAsync(importCommands()).toBeResolvedTo(expectedCmds);
      expect(logger.stdout).toEqual([]);
      expect(logger.stderr).toEqual([]);
    });

    it('automatically includes package information', async () => {
      await mockModuleCommands(path.resolve('.'), mockCmds);
      let cmds = await importCommands();

      expect(cmds[0].packageInformation.name).toEqual('@percy/cli-config');
    });

    it('handles errors and logs debug info', async () => {
      fs.$vol.fromJSON({ './node_modules': null });
      fs.readdirSync.and.throwError(new Error('EACCES'));
      await expectAsync(importCommands()).toBeResolvedTo([]);
      expect(logger.stdout).toEqual([]);
      expect(logger.stderr).toEqual([
        jasmine.stringContaining('[percy:cli:plugins] Error: EACCES')
      ]);
    });
  });

  describe('from node_modules with executable', () => {
    beforeEach(async () => {
      process.env.NODE_ENV = 'executable';
    });

    afterEach(() => {
      delete process.env.NODE_ENV;
    });

    const mockCmds = {
      '@percy/cli-exec': { name: 'exec' },
      '@percy/cli-config': { name: 'config' },
      '@percy/storybook': { name: 'storybook' },
      '@percy/core': null,
      '@percy/cli': null,
      'percy-cli-custom': { name: 'custom' },
      'percy-cli-other': null,
      'other-dep': null
    };

    const expectedCmds = [
      jasmine.objectContaining({ name: 'config' }),
      jasmine.objectContaining({ name: 'custom' }),
      jasmine.objectContaining({ name: 'exec' }),
      jasmine.objectContaining({ name: 'storybook' })
    ];

    it('imports from dependencies', async () => {
      await mockModuleCommands(path.resolve('.'), mockCmds);
      await expectAsync(importCommands()).toBeResolvedTo(expectedCmds);
      expect(logger.stdout).toEqual([]);
      expect(logger.stderr).toEqual([]);
    });

    it('imports from a parent directory', async () => {
      await mockModuleCommands(path.resolve('../..'), mockCmds);
      await expectAsync(importCommands()).toBeResolvedTo(expectedCmds);
      expect(logger.stdout).toEqual([]);
      expect(logger.stderr).toEqual([]);
    });

    it('imports from the current project', async () => {
      await mockModuleCommands(process.cwd(), mockCmds);
      await expectAsync(importCommands()).toBeResolvedTo(expectedCmds);
      expect(logger.stdout).toEqual([]);
      expect(logger.stderr).toEqual([]);
    });

    it('automatically includes package information', async () => {
      await mockModuleCommands(path.resolve('.'), mockCmds);
      let cmds = await importCommands();

      expect(cmds[0].packageInformation.name).toEqual('@percy/cli-config');
    });

    it('handles errors and logs debug info', async () => {
      fs.$vol.fromJSON({ './node_modules': null });
      fs.readdirSync.and.throwError(new Error('EACCES'));
      await expectAsync(importCommands()).toBeResolvedTo([]);
      expect(logger.stdout).toEqual([]);
      expect(logger.stderr).toEqual([
        jasmine.stringContaining('[percy:cli:plugins] Error: EACCES')
      ]);
    });
  });

  describe('from yarn pnp', () => {
    let Module, plugPnpApi;

    beforeEach(async () => {
      ({ default: Module } = await import('module'));
      Module.findPnpApi ||= (plugPnpApi = jasmine.createSpy('findPnpApi'));
    });

    afterEach(() => {
      if (plugPnpApi) delete Module.findPnpApi;
    });

    it('imports from the yarn pnp api', async () => {
      await mockPnpCommands(process.cwd(), {
        '@percy/cli-plugin': { name: 'plugin1' },
        'percy-cli-plugin': { name: 'plugin2' },
        'not-cli-plugin': null
      });

      await expectAsync(importCommands()).toBeResolvedTo([
        jasmine.objectContaining({ name: 'plugin1' }),
        jasmine.objectContaining({ name: 'plugin2' })
      ]);
    });
  });

  describe('legacy support', () => {
    it('transforms oclif-like classes', async () => {
      await mockLegacyCommands(process.cwd(), {
        '@percy/cli-legacy': { name: 'a' },
        '@percy/cli-legacy-topic': { name: 'b', index: true },
        '@percy/cli-legacy-index': { name: 'c', topic: true }
      });

      let commands = await importCommands();
      expect(commands).toHaveSize(3);

      expect(commands[0].name).toBe('a');
      expect(commands[0].callback).toBeDefined();
      expect(commands[0].definition.legacy).toBe(true);

      expect(commands[1].name).toBe('b');
      expect(commands[1].callback).toBeDefined();
      expect(commands[1].definition.legacy).toBe(true);
      expect(commands[1].definition.commands)
        .toEqual([{ asymmetricMatch: f => f.name === 'subcmd' }]);

      expect(commands[2].name).toBe('c');
      expect(commands[2].callback).toBeUndefined();
      expect(commands[2].definition.legacy).toBeUndefined();
      expect(commands[1].definition.commands)
        .toEqual([{ asymmetricMatch: f => f.name === 'subcmd' }]);
    });

    it('runs oclif init hooks', async () => {
      let init = jasmine.createSpy('init');

      await mockLegacyCommands(process.cwd(), {
        'percy-cli-legacy': { name: 'test', init }
      });

      await expectAsync(importCommands()).toBeResolvedTo([]);
      expect(init).toHaveBeenCalled();
    });
  });
});
