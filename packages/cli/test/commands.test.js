import path from 'path';
import logger from '@percy/logger/test/helpers';

import {
  mockfs,
  mockRequire,
  mockModuleCommands,
  mockPnpCommands,
  mockLegacyCommands
} from './helpers';

describe('CLI commands', () => {
  let importCommands;

  beforeEach(() => {
    mockfs();
    logger.mock();
    logger.loglevel('debug');
    ({ importCommands } = mockRequire.reRequire('../src/commands'));
  });

  afterEach(() => {
    mockfs.reset();
    mockRequire.stopAll();
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
      mockModuleCommands(path.join(__dirname, '..'), mockCmds);
      await expectAsync(importCommands()).toBeResolvedTo(expectedCmds);
      expect(logger.stdout).toEqual([]);
      expect(logger.stderr).toEqual([]);
    });

    it('imports from a parent directory', async () => {
      mockModuleCommands(path.join(__dirname, '..', '..', '..'), mockCmds);
      await expectAsync(importCommands()).toBeResolvedTo(expectedCmds);
      expect(logger.stdout).toEqual([]);
      expect(logger.stderr).toEqual([]);
    });

    it('imports from the current project', async () => {
      mockModuleCommands(process.cwd(), mockCmds);
      await expectAsync(importCommands()).toBeResolvedTo(expectedCmds);
      expect(logger.stdout).toEqual([]);
      expect(logger.stderr).toEqual([]);
    });

    it('handles errors and logs debug info', async () => {
      mockfs.mkdirSync('node_modules', { recursive: true });
      spyOn(require('fs'), 'readdirSync').and.throwError(new Error('EACCES'));
      await expectAsync(importCommands()).toBeResolvedTo([]);
      expect(logger.stdout).toEqual([]);
      expect(logger.stderr).toEqual([
        jasmine.stringContaining('[percy:cli:plugins] Error: EACCES')
      ]);
    });
  });

  describe('from yarn pnp', () => {
    beforeEach(() => {
      let findPnpApi = jasmine.createSpy('findPnpApi');
      mockRequire('module', { findPnpApi: findPnpApi.and.returnValue() });
      ({ importCommands } = mockRequire.reRequire('../src/commands'));
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
      mockLegacyCommands(process.cwd(), {
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

      mockLegacyCommands(process.cwd(), {
        '@percy/cli-legacy': { name: 'test', init }
      });

      await expectAsync(importCommands()).toBeResolvedTo([]);
      expect(init).toHaveBeenCalled();
    });
  });
});
