import helpers from './helpers';
import { colors } from '../src/util';
import logger from '../src';

describe('logger', () => {
  let log;

  beforeEach(() => {
    helpers.mock({ ansi: true });
    log = logger('test');
  });

  afterEach(() => {
    delete process.env.PERCY_LOGLEVEL;
    delete process.env.PERCY_DEBUG;
  });

  it('creates a namespaced logger', () => {
    expect(log).toHaveProperty('info', jasmine.any(Function));
    expect(log).toHaveProperty('warn', jasmine.any(Function));
    expect(log).toHaveProperty('error', jasmine.any(Function));
    expect(log).toHaveProperty('debug', jasmine.any(Function));
    expect(log).toHaveProperty('progress', jasmine.any(Function));
    expect(log).toHaveProperty('deprecated', jasmine.any(Function));
  });

  it('has a default log level', () => {
    expect(log.loglevel()).toEqual('info');
    expect(logger.loglevel()).toEqual('info');
  });

  it('saves logs to an in-memory store', () => {
    log.info('Info log', { foo: 'bar' });
    log.warn('Warn log', { bar: 'baz' });
    log.error('Error log', { to: 'be' });
    log.debug('Debug log', { not: 'to be' });
    log.deprecated('Deprecation log', { test: 'me' });

    let entry = (level, message, meta) => ({
      timestamp: jasmine.any(Number),
      debug: 'test',
      level,
      message,
      meta
    });

    expect(helpers.messages).toEqual(new Set([
      entry('info', 'Info log', { foo: 'bar' }),
      entry('warn', 'Warn log', { bar: 'baz' }),
      entry('error', 'Error log', { to: 'be' }),
      entry('debug', 'Debug log', { not: 'to be' }),
      entry('warn', 'Warning: Deprecation log', { test: 'me' })
    ]));
  });

  it('writes info logs to stdout', () => {
    log.info('Info log');

    expect(helpers.stderr).toEqual([]);
    expect(helpers.stdout).toEqual([
      `[${colors.magenta('percy')}] Info log`
    ]);
  });

  it('writes warning and error logs to stderr', () => {
    log.warn('Warn log');
    log.error('Error log');

    expect(helpers.stdout).toEqual([]);
    expect(helpers.stderr).toEqual([
      `[${colors.magenta('percy')}] ${colors.yellow('Warn log')}`,
      `[${colors.magenta('percy')}] ${colors.red('Error log')}`
    ]);
  });

  it('highlights info URLs blue', () => {
    log.info('URL: https://percy.io');

    expect(helpers.stdout).toEqual([
      `[${colors.magenta('percy')}] URL: ${colors.blue('https://percy.io')}`
    ]);
  });

  it('captures error stack traces without writing them', () => {
    let error = new Error('test');
    log.error(error);

    expect(helpers.messages).toContain({
      debug: 'test',
      level: 'error',
      message: error.stack,
      timestamp: jasmine.any(Number),
      meta: {}
    });

    expect(helpers.stderr).toEqual([
      `[${colors.magenta('percy')}] ${colors.red('Error: test')}`
    ]);
  });

  it('does not write debug logs by default', () => {
    log.debug('Debug log');
    expect(helpers.stdout).toEqual([]);
    expect(helpers.stderr).toEqual([]);
  });

  it('prevents duplicate deprecation logs', () => {
    log.deprecated('Update me');
    log.deprecated('Update me');
    log.deprecated('Update me');
    log.deprecated('Update me too');

    expect(helpers.stderr).toEqual([
      `[${colors.magenta('percy')}] ${colors.yellow('Warning: Update me')}`,
      `[${colors.magenta('percy')}] ${colors.yellow('Warning: Update me too')}`
    ]);
  });

  it('can query for logs from the in-memory store', () => {
    log.info('Not me', { match: false });
    log.info('Not me', { match: false });
    log.info('Yes me', { match: true });
    log.info('Not me', { match: false });
    log.info('Not me', { match: false });

    expect(logger.query(m => m.meta.match)).toEqual([{
      debug: 'test',
      level: 'info',
      message: 'Yes me',
      timestamp: jasmine.any(Number),
      meta: { match: true }
    }]);
  });

  it('exposes a message formatting method', () => {
    expect(log.format('grouped')).toEqual(
      `[${colors.magenta('percy')}] grouped`);
    expect(log.format('warn', 'level')).toEqual(
      `[${colors.magenta('percy')}] ${colors.yellow('level')}`);
    expect(log.format('error', 'level')).toEqual(
      `[${colors.magenta('percy')}] ${colors.red('level')}`);

    expect(logger.format('ungrouped')).toEqual(
      `[${colors.magenta('percy')}] ungrouped`);
    expect(logger.format('other', 'long')).toEqual(
      `[${colors.magenta('percy')}] long`);
    expect(logger.format('other', 'warn', 'long level')).toEqual(
      `[${colors.magenta('percy')}] ${colors.yellow('long level')}`);
    expect(logger.format('other', 'error', 'elapsed', 100)).toEqual(
      `[${colors.magenta('percy')}] ${colors.red('elapsed')}`);

    log.loglevel('debug');

    expect(log.format('grouped')).toEqual(
      `[${colors.magenta('percy:test')}] grouped`);
    expect(log.format('error', 'level')).toEqual(
      `[${colors.magenta('percy:test')}] ${colors.red('level')}`);

    expect(logger.format('ungrouped')).toEqual(
      `[${colors.magenta('percy')}] ungrouped`);
    expect(logger.format('other', 'long')).toEqual(
      `[${colors.magenta('percy:other')}] long`);
    expect(logger.format('other', 'warn', 'elapsed', 100)).toEqual(
      `[${colors.magenta('percy:other')}] ` +
        `${colors.yellow('elapsed')} ${colors.grey('(100ms)')}`);
  });

  it('exposes own stdout and stderr streams', () => {
    expect(logger.stdout).toBe(logger.Logger.stdout);
    expect(logger.stderr).toBe(logger.Logger.stderr);
  });

  describe('levels', () => {
    it('can be initially set by defining PERCY_LOGLEVEL', () => {
      helpers.reset();
      process.env.PERCY_LOGLEVEL = 'error';
      expect(logger.loglevel()).toEqual('error');
    });

    it('can be controlled by a secondary flags argument', () => {
      logger.loglevel('info', { debug: true });
      expect(logger.loglevel()).toEqual('debug');
      logger.loglevel('info', { verbose: true });
      expect(logger.loglevel()).toEqual('debug');
      logger.loglevel('info', { quiet: true });
      expect(logger.loglevel()).toEqual('warn');
      logger.loglevel('info', { silent: true });
      expect(logger.loglevel()).toEqual('silent');
      logger.loglevel('info', { foobar: true });
      expect(logger.loglevel()).toEqual('info');
    });

    it('logs only warnings and errors when loglevel is "warn"', () => {
      log.loglevel('warn');

      log.info('Info log');
      log.warn('Warn log');
      log.error('Error log');
      log.debug('Debug log');

      expect(helpers.stdout).toEqual([]);
      expect(helpers.stderr).toEqual([
        `[${colors.magenta('percy')}] ${colors.yellow('Warn log')}`,
        `[${colors.magenta('percy')}] ${colors.red('Error log')}`
      ]);
    });

    it('logs only errors when loglevel is "error"', () => {
      log.loglevel('error');

      log.info('Info log');
      log.warn('Warn log');
      log.error('Error log');
      log.debug('Debug log');

      expect(helpers.stdout).toEqual([]);
      expect(helpers.stderr).toEqual([
        `[${colors.magenta('percy')}] ${colors.red('Error log')}`
      ]);
    });

    it('logs everything when loglevel is "debug"', () => {
      log.loglevel('debug');

      log.info('Info log');
      log.warn('Warn log');
      log.error('Error log');
      log.debug('Debug log');

      expect(helpers.stdout).toEqual([
        `[${colors.magenta('percy:test')}] Info log`
      ]);
      expect(helpers.stderr).toEqual([
        `[${colors.magenta('percy:test')}] ${colors.yellow('Warn log')}`,
        `[${colors.magenta('percy:test')}] ${colors.red('Error log')}`,
        `[${colors.magenta('percy:test')}] Debug log`
      ]);
    });

    it('logs error stack traces when loglevel is "debug"', () => {
      let error = new Error('test');
      log.loglevel('debug');
      log.error(error);

      expect(helpers.stderr).toEqual([
        `[${colors.magenta('percy:test')}] ${colors.red(error.stack)}`
      ]);
    });

    it('stringifies error-like objects when loglevel is "debug"', () => {
      let errorlike = { toString: () => 'ERROR' };
      log.loglevel('debug');
      log.debug(errorlike);

      expect(helpers.stderr).toEqual([
        `[${colors.magenta('percy:test')}] ${colors.red('ERROR')}`
      ]);
    });

    it('logs elapsed time when loglevel is "debug"', async () => {
      helpers.mock({ elapsed: true });
      logger.loglevel('debug');
      log = logger('test');

      log.info('Info log');
      log.warn('Warn log');
      log.error('Error log');
      await new Promise(r => setTimeout(r, 100));
      log.debug('Debug log');
      log.error('Final log');

      expect(helpers.stdout).toEqual([
        jasmine.stringMatching('Info log \\(\\dms\\)')
      ]);

      expect(helpers.stderr).toEqual([
        jasmine.stringMatching('Warn log \\(\\dms\\)'),
        jasmine.stringMatching('Error log \\(\\dms\\)'),
        jasmine.stringMatching('Debug log \\(\\d{2,3}ms\\)'),
        jasmine.stringMatching('Final log \\(\\dms\\)')
      ]);
    });
  });

  describe('debugging', () => {
    beforeEach(() => {
      helpers.reset();
    });

    it('enables debug logging when PERCY_DEBUG is defined', () => {
      process.env.PERCY_DEBUG = '*';
      helpers.mock({ ansi: true });

      logger('test').debug('Debug log');

      expect(logger.loglevel()).toEqual('debug');
      expect(helpers.stderr).toEqual([
        `[${colors.magenta('percy:test')}] Debug log`
      ]);
    });

    it('filters specific logs for debugging', () => {
      process.env.PERCY_DEBUG = 'test:*,-test:2,';
      helpers.mock({ ansi: true });

      logger('test').debug('Debug test');
      logger('test:1').debug('Debug test 1');
      logger('test:2').debug('Debug test 2');
      logger('test:3').debug('Debug test 3');

      expect(helpers.stderr).toEqual([
        `[${colors.magenta('percy:test')}] Debug test`,
        `[${colors.magenta('percy:test:1')}] Debug test 1`,
        `[${colors.magenta('percy:test:3')}] Debug test 3`
      ]);
    });

    it('does not do anything when PERCY_DEBUG is blank', () => {
      process.env.PERCY_DEBUG = ' ';
      helpers.mock({ ansi: true });

      logger('test').debug('Debug log');

      expect(logger.loglevel()).toEqual('info');
      expect(helpers.stderr).toEqual([]);
    });
  });

  if (!process.env.__PERCY_BROWSERIFIED__) {
    describe('progress', () => {
      let stdout;

      let resetSpies = () => {
        stdout.cursorTo.calls.reset();
        stdout.clearLine.calls.reset();
        stdout.write.calls.reset();
      };

      beforeEach(() => {
        stdout = logger.Logger.stdout;
        stdout.isTTY = true;
        spyOn(stdout, 'cursorTo');
        spyOn(stdout, 'clearLine');
        spyOn(stdout, 'write').and.callThrough();
      });

      it('does not log when loglevel prevents "info" logs', () => {
        logger.loglevel('error');
        log.progress('foo');

        expect(stdout.cursorTo).not.toHaveBeenCalled();
        expect(stdout.write).not.toHaveBeenCalled();
        expect(stdout.clearLine).not.toHaveBeenCalled();
      });

      it('replaces the current log line', () => {
        log.progress('foo');

        expect(stdout.cursorTo).toHaveBeenCalledWith(0);
        expect(stdout.cursorTo).toHaveBeenCalledBefore(stdout.write);
        expect(stdout.write).toHaveBeenCalledWith(`[${colors.magenta('percy')}] foo`);
        expect(stdout.write).toHaveBeenCalledBefore(stdout.clearLine);
        expect(stdout.clearLine).toHaveBeenCalledWith(1);
      });

      it('replaces progress with the next log', () => {
        log.progress('foo');
        resetSpies();

        log.info('bar');

        expect(stdout.cursorTo).toHaveBeenCalledWith(0);
        expect(stdout.cursorTo).toHaveBeenCalledBefore(stdout.clearLine);
        expect(stdout.clearLine).toHaveBeenCalledWith();
        expect(stdout.clearLine).toHaveBeenCalledBefore(stdout.write);
        expect(stdout.write).toHaveBeenCalledWith(`[${colors.magenta('percy')}] bar\n`);
      });

      it('clears last progress when empty', () => {
        log.progress('foo');
        resetSpies();

        log.progress();

        expect(stdout.cursorTo).toHaveBeenCalledWith(0);
        expect(stdout.cursorTo).toHaveBeenCalledBefore(stdout.clearLine);
        expect(stdout.clearLine).toHaveBeenCalledWith(1);
        expect(stdout.write).not.toHaveBeenCalled();
      });

      it('can persist progress after the next log', () => {
        log.progress('foo', true);
        resetSpies();

        log.info('bar');

        expect(stdout.cursorTo).toHaveBeenCalledWith(0);
        expect(stdout.clearLine).toHaveBeenCalledWith();
        expect(stdout.write).toHaveBeenCalledWith(`[${colors.magenta('percy')}] bar\n`);
        expect(stdout.write).toHaveBeenCalledWith(`[${colors.magenta('percy')}] foo`);
      });

      describe('without a TTY', () => {
        beforeEach(() => {
          stdout.isTTY = false;
        });

        it('logs only the first consecutive progress call', () => {
          log.progress('foo');
          log.progress('bar');
          log.progress('baz');

          expect(stdout.cursorTo).not.toHaveBeenCalled();
          expect(stdout.write).toHaveBeenCalledWith(`[${colors.magenta('percy')}] foo\n`);
          expect(stdout.clearLine).not.toHaveBeenCalled();
        });

        it('does not replace progress with the next log', () => {
          log.progress('foo');
          resetSpies();

          log.info('bar');

          expect(stdout.cursorTo).not.toHaveBeenCalled();
          expect(stdout.clearLine).not.toHaveBeenCalled();
          expect(stdout.write).toHaveBeenCalledWith(`[${colors.magenta('percy')}] bar\n`);
        });

        it('ignores consecutive persistant logs after the first', () => {
          log.progress('foo', true);
          log.info('bar');
          log.progress('baz', true);
          log.info('qux');

          expect(stdout.cursorTo).not.toHaveBeenCalled();
          expect(stdout.write).toHaveBeenCalledTimes(3);
          expect(stdout.write).toHaveBeenCalledWith(`[${colors.magenta('percy')}] foo\n`);
          expect(stdout.write).toHaveBeenCalledWith(`[${colors.magenta('percy')}] bar\n`);
          expect(stdout.write).not.toHaveBeenCalledWith(`[${colors.magenta('percy')}] baz\n`);
          expect(stdout.write).toHaveBeenCalledWith(`[${colors.magenta('percy')}] qux\n`);
          expect(stdout.clearLine).not.toHaveBeenCalled();
        });
      });
    });
  } else {
    describe('browser support', () => {
      it('logs messages with CSS colors', () => {
        log.info('Colorful!');

        expect(console.log.calls).toEqual([
          ['[%cpercy%c] Colorful!', 'color:magenta', 'color:inherit']
        ]);
      });

      it('logs errors with console.error', () => {
        log.error('ERR!');

        expect(console.error.calls).toEqual([
          ['[%cpercy%c] %cERR!%c', 'color:magenta', 'color:inherit', 'color:red', 'color:inherit']
        ]);
      });

      it('logs warnings with console.warn', () => {
        log.warn('Warning!');

        expect(console.warn.calls).toEqual([
          ['[%cpercy%c] %cWarning!%c', 'color:magenta', 'color:inherit', 'color:yellow', 'color:inherit']
        ]);
      });

      it('logs an error when attempting to use the #progress() method', () => {
        log.progress('==>');

        expect(console.error.calls).toEqual([
          ['The log.progress() method is not supported in browsers']
        ]);
      });
    });
  }
});
