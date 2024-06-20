import { logger, dedent } from './helpers.js';
import command from '@percy/cli-command';

describe('Built-in flags:', () => {
  let test;

  beforeEach(async () => {
    await logger.mock();

    test = command('foo', {}, ({ log }) => {
      log.info('information');
      log.error('error message');
      log.debug('debug information');
    });
  });

  describe('--quiet', () => {
    it('sets the loglevel to warn', async () => {
      await test(['--quiet']);

      expect(logger.loglevel()).toEqual('warn');
      expect(logger.stdout).toEqual([]);
      expect(logger.stderr).toEqual([
        '[percy] error message'
      ]);
    });
  });

  describe('--silent', () => {
    it('sets the loglevel to silent', async () => {
      await test(['--silent']);

      expect(logger.loglevel()).toEqual('silent');
      expect(logger.stdout).toEqual([]);
      expect(logger.stderr).toEqual([]);
    });
  });

  describe('--verbose', () => {
    it('sets the loglevel to debug', async () => {
      await test(['--verbose']);

      expect(logger.loglevel()).toEqual('debug');
      expect(logger.stdout).toEqual([
        '[percy:cli] information'
      ]);
      expect(logger.stderr).toEqual([
        '[percy:cli] error message',
        '[percy:cli] debug information'
      ]);
    });
  });

  describe('--build-tags', () => {
    it('sets buildTags to the given tag names', async () => {
      test = command('percy', {
        percy: {}
      }, ({ percy }) => {
        test.percy = percy;
      });

      await test(['--build-tags=tag1,tag2']);

      expect(test.percy.buildTags).toBe('tag1,tag2');
    });
  });

  describe('Percy flags:', () => {
    const expectedMinPercyFlags = jasmine.stringContaining(dedent`
      Percy options:
        -c, --config <file>  Config file path
        -d, --dry-run        Print snapshot names only
    `);

    const expectedAllPercyFlags = jasmine.stringContaining(dedent`
      Percy options:
        -c, --config <file>                Config file path
        -d, --dry-run                      Print snapshot names only
        -h, --allowed-hostname <hostname>  Allowed hostnames to capture in asset discovery
        --disallowed-hostname <hostname>   Disallowed hostnames to abort in asset discovery
        -t, --network-idle-timeout <ms>    Asset discovery network idle timeout
        --disable-cache                    Disable asset discovery caches
        --debug                            Debug asset discovery and do not upload snapshots
    `);

    it('is not shown by default', async () => {
      await command('foo', {})(['--help']);
      expect(logger.stdout).not.toEqual([expectedMinPercyFlags]);
      expect(logger.stdout).not.toEqual([expectedAllPercyFlags]);
    });

    it('is not shown when percy options are not provided', async () => {
      await command('foo', { percy: true })(['--help']);
      expect(logger.stdout).not.toEqual([expectedMinPercyFlags]);
      expect(logger.stdout).not.toEqual([expectedAllPercyFlags]);
    });

    it('is shown when percy options are provided', async () => {
      await command('foo', { percy: {} })(['--help']);
      expect(logger.stdout).not.toEqual([expectedMinPercyFlags]);
      expect(logger.stdout).toEqual([expectedAllPercyFlags]);
    });

    it('does not show discovery flags when excluded', async () => {
      await command('foo', { percy: { skipDiscovery: true } })(['--help']);
      expect(logger.stdout).toEqual([expectedMinPercyFlags]);
      expect(logger.stdout).not.toEqual([expectedAllPercyFlags]);
    });

    it('shows additional server flags when enabled', async () => {
      let options = { server: true, skipDiscovery: true };
      await command('foo', { percy: options })(['--help']);
      expect(logger.stdout).not.toEqual([expectedAllPercyFlags]);
      expect(logger.stdout).toEqual([expectedMinPercyFlags]);
      expect(logger.stdout).toEqual([jasmine.stringContaining(
        '  -P, --port [number]  Local CLI server port (default: 5338)'
      )]);
    });

    describe('--debug', () => {
      it('sets the loglevel to debug and skips percy uploads', async () => {
        test = command('percy', {
          percy: {}
        }, ({ percy, log }) => {
          log.info('information');
          log.debug('debug percy');
          test.percy = percy;
        });

        await test(['--debug']);

        expect(test.percy.skipUploads).toBe(true);
        expect(logger.loglevel()).toEqual('debug');
        expect(logger.stdout).toEqual([
          '[percy:cli] information'
        ]);
        expect(logger.stderr).toEqual(
          jasmine.arrayContaining([
            '[percy:cli] debug percy'
          ]));
      });
    });
  });
});
