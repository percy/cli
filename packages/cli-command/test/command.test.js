import expect from 'expect';
import log from '@percy/logger';
import stdio from '@percy/logger/test/helper';
import PercyConfig from '@percy/config';
import PercyCommand, { flags } from '../src';

// add config schema to test discovery flags
PercyConfig.addSchema(require('@percy/core/dist/config').schema);

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
  });

  afterEach(() => {
    delete process.env.PERCY_TOKEN;
    delete process.env.PERCY_ENABLE;
    process.removeAllListeners();
    log.loglevel('error');
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
    expect(log.loglevel()).toBe('error');
    await TestPercyCommand.run([]);
    expect(log.loglevel()).toBe('info');
    await TestPercyCommand.run(['--verbose']);
    expect(log.loglevel()).toBe('debug');
    await TestPercyCommand.run(['--quiet']);
    expect(log.loglevel()).toBe('warn');
    await TestPercyCommand.run(['--silent']);
    expect(log.loglevel()).toBe('silent');
  });

  it('logs errors to the logger and exits', async () => {
    class TestPercyCommandError extends TestPercyCommand {
      test() { this.error('test error'); }
    }

    await expect(stdio.capture(() => (
      TestPercyCommandError.run([])
    ))).rejects.toThrow('EEXIT: 1');

    expect(stdio[1]).toHaveLength(0);
    expect(stdio[2]).toEqual([
      '[percy] Error: test error\n'
    ]);
  });

  it('does not log exit "errors"', async () => {
    class TestPercyCommandExit extends TestPercyCommand {
      test() { this.exit(1); }
    }

    await expect(stdio.capture(() => (
      TestPercyCommandExit.run([])
    ))).rejects.toThrow('EEXIT: 1');

    expect(stdio[1]).toHaveLength(0);
    expect(stdio[2]).toHaveLength(0);
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
      process.env.PERCY_TOKEN = '<<PERCY_TOKEN>>';

      await expect(TestPercyCommand.run([
        '--allowed-hostname', '*.percy.io',
        '--network-idle-timeout', '150',
        '--disable-cache',
        'foo', 'bar'
      ])).resolves.toBeUndefined();

      expect(results[0].percyrc()).toEqual({
        version: 2,
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
  });
});
