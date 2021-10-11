import logger from '@percy/logger/test/helpers';
import PercyConfig from '@percy/config';
import { configSchema } from '@percy/core/dist/config';
import PercyCommand, { flags } from '../src';

// add config schema to test discovery flags
PercyConfig.addSchema(configSchema);

describe('PercyCommand', () => {
  let results;

  class TestPercyCommand extends PercyCommand {
    static args = [
      { name: 'one' },
      { name: 'two' }
    ];

    static flags = {
      ...flags.logging,
      ...flags.discovery,
      ...flags.config
    }

    async run() {
      results.unshift(this);
      await this.test?.();
    }
  }

  beforeEach(() => {
    results = [];
    logger.mock();
  });

  afterEach(() => {
    delete process.env.PERCY_TOKEN;
    delete process.env.PERCY_ENABLE;
    process.removeAllListeners();
  });

  it('initializes arguments and flags', async () => {
    await TestPercyCommand.run([
      '--allowed-hostname', '*.percy.io',
      '--network-idle-timeout', '150',
      '--disable-cache',
      'foo', 'bar'
    ]);

    expect(results[0]).toHaveProperty('args.one', 'foo');
    expect(results[0]).toHaveProperty('args.two', 'bar');
    expect(results[0]).toHaveProperty('flags', {
      'allowed-hostname': ['*.percy.io'],
      'network-idle-timeout': 150,
      'disable-cache': true
    });
  });

  it('sets the appropriate loglevel', async () => {
    logger.loglevel('error');
    expect(logger.loglevel()).toBe('error');
    await TestPercyCommand.run([]);
    expect(logger.loglevel()).toBe('info');
    await TestPercyCommand.run(['--verbose']);
    expect(logger.loglevel()).toBe('debug');
    await TestPercyCommand.run(['--quiet']);
    expect(logger.loglevel()).toBe('warn');
    await TestPercyCommand.run(['--silent']);
    expect(logger.loglevel()).toBe('silent');
    await TestPercyCommand.run(['--debug']);
    expect(logger.loglevel()).toBe('debug');
  });

  it('logs errors to the logger and exits', async () => {
    class TestPercyCommandError extends TestPercyCommand {
      test() { this.error('test error'); }
    }

    await expectAsync(TestPercyCommandError.run([])).toBeRejectedWithError('EEXIT: 1');

    expect(logger.stdout).toEqual([]);
    expect(logger.stderr).toEqual([
      '[percy] Error: test error'
    ]);
  });

  it('does not log exit "errors"', async () => {
    class TestPercyCommandExit extends TestPercyCommand {
      test() { this.exit(1); }
    }

    await expectAsync(TestPercyCommandExit.run([])).toBeRejectedWithError('EEXIT: 1');

    expect(logger.stdout).toEqual([]);
    expect(logger.stderr).toEqual([]);
  });

  it('calls #finally() when the process is terminated', async () => {
    let wait = ms => new Promise(r => setTimeout(r, ms));
    let test = 0;

    class TestPercyCommandTerm extends TestPercyCommand {
      test = () => wait(100).then(() => test--)
      finally() { test++; }
    }

    // not awaited on so we can terminate it afterwards
    TestPercyCommandTerm.run([]);
    // wait a little for the process handler to be attached
    await wait(50);

    process.emit('SIGTERM');
    expect(test).toBe(1);
  });

  describe('#isPercyEnabled()', () => {
    it('reflects the PERCY_ENABLE environment variable', async () => {
      await TestPercyCommand.run([]);
      expect(results[0].isPercyEnabled()).toBe(true);
      process.env.PERCY_ENABLE = '0';
      expect(results[0].isPercyEnabled()).toBe(false);
    });
  });

  describe('#percyrc()', () => {
    it('returns Percy config and parsed flags', async () => {
      await expectAsync(TestPercyCommand.run([
        '--allowed-hostname', '*.percy.io',
        '--network-idle-timeout', '150',
        '--disable-cache',
        '--dry-run',
        '--debug',
        'foo', 'bar'
      ])).toBeResolved();

      expect(results[0].percyrc()).toEqual({
        version: 2,
        config: false,
        skipUploads: true,
        dryRun: true,
        snapshot: {
          widths: [375, 1280],
          minHeight: 1024,
          percyCSS: ''
        },
        discovery: {
          allowedHostnames: ['*.percy.io'],
          networkIdleTimeout: 150,
          disableCache: true
        }
      });
    });

    it('does not replace initial overrides with empty flags', async () => {
      await expectAsync(TestPercyCommand.run([])).toBeResolved();

      expect(results[0].percyrc({
        discovery: { disableCache: true }
      })).toHaveProperty('discovery.disableCache', true);
    });

    it('logs warnings for deprecated flags', async () => {
      class TestPercyCommandDeprecated extends TestPercyCommand {
        static flags = {
          generic: flags.boolean({
            deprecated: true
          }),
          version: flags.boolean({
            deprecated: { until: '1.0.0' }
          }),
          mapped: flags.boolean({
            deprecated: { map: 'foo' }
          }),
          instruct: flags.boolean({
            deprecated: { alt: 'See docs.' }
          }),
          deprecated: flags.boolean({
            deprecated: {
              until: '1.0.0',
              map: 'bar'
            }
          })
        }
      }

      await expectAsync(TestPercyCommandDeprecated.run([
        '--generic', '--version', '--mapped', '--instruct', '--deprecated'
      ])).toBeResolved();

      expect(logger.stderr).toEqual([
        '[percy] Warning: The --generic flag will be removed in a future release.',
        '[percy] Warning: The --version flag will be removed in 1.0.0.',
        '[percy] Warning: The --mapped flag will be removed in a future release. Use --foo instead.',
        '[percy] Warning: The --instruct flag will be removed in a future release. See docs.',
        '[percy] Warning: The --deprecated flag will be removed in 1.0.0. Use --bar instead.'
      ]);

      expect(results[0].flags).toEqual({
        generic: true,
        version: true,
        mapped: true,
        instruct: true,
        deprecated: true,
        foo: true,
        bar: true
      });
    });
  });
});
