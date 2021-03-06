import colors from '../src/colors';
import helper from './helper';
import logger from '../src';

describe('logger', () => {
  let log;

  beforeEach(() => {
    helper.mock({ ansi: true });
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
    expect(log).toHaveProperty('deprecated', jasmine.any(Function));
  });

  it('has a default log level', () => {
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

    expect(logger.instance.messages).toEqual(new Set([
      entry('info', 'Info log', { foo: 'bar' }),
      entry('warn', 'Warn log', { bar: 'baz' }),
      entry('error', 'Error log', { to: 'be' }),
      entry('debug', 'Debug log', { not: 'to be' }),
      entry('warn', 'Warning: Deprecation log', { test: 'me' })
    ]));
  });

  it('writes info logs to stdout', () => {
    log.info('Info log');

    expect(helper.stderr).toEqual([]);
    expect(helper.stdout).toEqual([
      `[${colors.magenta('percy')}] Info log\n`
    ]);
  });

  it('writes warning and error logs to stderr', () => {
    log.warn('Warn log');
    log.error('Error log');

    expect(helper.stdout).toEqual([]);
    expect(helper.stderr).toEqual([
      `[${colors.magenta('percy')}] ${colors.yellow('Warn log')}\n`,
      `[${colors.magenta('percy')}] ${colors.red('Error log')}\n`
    ]);
  });

  it('highlights info URLs blue', () => {
    log.info('URL: https://percy.io');

    expect(helper.stdout).toEqual([
      `[${colors.magenta('percy')}] URL: ${colors.blue('https://percy.io')}\n`
    ]);
  });

  it('captures error stack traces without writing them', () => {
    let error = new Error('test');
    log.error(error);

    expect(logger.instance.messages).toContain({
      debug: 'test',
      level: 'error',
      message: error.stack,
      timestamp: jasmine.any(Number),
      meta: {}
    });

    expect(helper.stderr).toEqual([
      `[${colors.magenta('percy')}] ${colors.red('Error: test')}\n`
    ]);
  });

  it('does not write debug logs by default', () => {
    log.debug('Debug log');
    expect(helper.stdout).toEqual([]);
    expect(helper.stderr).toEqual([]);
  });

  it('prevents duplicate deprecation logs', () => {
    log.deprecated('Update me');
    log.deprecated('Update me');
    log.deprecated('Update me');
    log.deprecated('Update me too');

    expect(helper.stderr).toEqual([
      `[${colors.magenta('percy')}] ${colors.yellow('Warning: Update me')}\n`,
      `[${colors.magenta('percy')}] ${colors.yellow('Warning: Update me too')}\n`
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
    expect(logger.format('information')).toEqual(
      `[${colors.magenta('percy')}] information`
    );

    logger.loglevel('debug');

    expect(logger.format('wat')).toEqual(
      `[${colors.magenta('percy')}] wat`
    );

    expect(logger.format('debugging', 'test')).toEqual(
      `[${colors.magenta('percy:test')}] debugging`
    );

    expect(logger.format('failure', 'test', 'error')).toEqual(
      `[${colors.magenta('percy:test')}] ${colors.red('failure')}`
    );

    logger.loglevel('error');

    expect(logger.format('warning', 'test', 'warn')).toEqual(
      `[${colors.magenta('percy')}] ${colors.yellow('warning')}`
    );
  });

  describe('levels', () => {
    it('can be initially set by defining PERCY_LOGLEVEL', () => {
      delete logger.instance;
      process.env.PERCY_LOGLEVEL = 'error';
      expect(logger.loglevel()).toEqual('error');
    });

    it('can be controlled by a secondary flags argument', () => {
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
      logger.loglevel('warn');

      log.info('Info log');
      log.warn('Warn log');
      log.error('Error log');
      log.debug('Debug log');

      expect(helper.stdout).toEqual([]);
      expect(helper.stderr).toEqual([
        `[${colors.magenta('percy')}] ${colors.yellow('Warn log')}\n`,
        `[${colors.magenta('percy')}] ${colors.red('Error log')}\n`
      ]);
    });

    it('logs only errors when loglevel is "error"', () => {
      logger.loglevel('error');

      log.info('Info log');
      log.warn('Warn log');
      log.error('Error log');
      log.debug('Debug log');

      expect(helper.stdout).toEqual([]);
      expect(helper.stderr).toEqual([
        `[${colors.magenta('percy')}] ${colors.red('Error log')}\n`
      ]);
    });

    it('logs everything when loglevel is "debug"', () => {
      logger.loglevel('debug');

      log.info('Info log');
      log.warn('Warn log');
      log.error('Error log');
      log.debug('Debug log');

      expect(helper.stdout).toEqual([
        `[${colors.magenta('percy:test')}] Info log\n`
      ]);

      expect(helper.stderr).toEqual([
        `[${colors.magenta('percy:test')}] ${colors.yellow('Warn log')}\n`,
        `[${colors.magenta('percy:test')}] ${colors.red('Error log')}\n`,
        `[${colors.magenta('percy:test')}] Debug log\n`
      ]);
    });

    it('logs error stack traces when loglevel is "debug"', () => {
      let error = new Error('test');
      logger.loglevel('debug');
      log.error(error);

      expect(helper.stderr).toEqual([
        `[${colors.magenta('percy:test')}] ${colors.red(error.stack)}\n`
      ]);
    });

    it('stringifies error-like objects when loglevel is "debug"', () => {
      let errorlike = { toString: () => 'ERROR' };
      logger.loglevel('debug');
      log.debug(errorlike);

      expect(helper.stderr).toEqual([
        `[${colors.magenta('percy:test')}] ${colors.red('ERROR')}\n`
      ]);
    });

    it('logs elapsed time when loglevel is "debug"', async () => {
      // it is hard to escape ansi colors with `stringMatching`, which is needed because the time
      // between logs can vary by a few milliseconds
      helper.mock({ elapsed: true });
      logger.loglevel('debug');
      log = logger('test');

      log.info('Info log');
      log.warn('Warn log');
      log.error('Error log');
      await new Promise(r => setTimeout(r, 100));
      log.debug('Debug log');

      expect(helper.stdout).toEqual([
        jasmine.stringMatching('Info log \\(\\dms\\)\\n')
      ]);

      expect(helper.stderr).toEqual([
        jasmine.stringMatching('Warn log \\(\\dms\\)\\n'),
        jasmine.stringMatching('Error log \\(\\dms\\)\\n'),
        jasmine.stringMatching('Debug log \\(10\\dms\\)\\n')
      ]);
    });
  });

  describe('debugging', () => {
    beforeEach(() => {
      delete logger.instance;
    });

    it('enables debug logging when PERCY_DEBUG is defined', () => {
      process.env.PERCY_DEBUG = '*';
      helper.mock({ ansi: true });

      logger('test').debug('Debug log');

      expect(logger.loglevel()).toEqual('debug');
      expect(helper.stderr).toEqual([
        `[${colors.magenta('percy:test')}] Debug log\n`
      ]);
    });

    it('filters specific logs for debugging', () => {
      process.env.PERCY_DEBUG = 'test:*,-test:2,';
      helper.mock({ ansi: true });

      logger('test').debug('Debug test');
      logger('test:1').debug('Debug test 1');
      logger('test:2').debug('Debug test 2');
      logger('test:3').debug('Debug test 3');

      expect(helper.stderr).toEqual([
        `[${colors.magenta('percy:test')}] Debug test\n`,
        `[${colors.magenta('percy:test:1')}] Debug test 1\n`,
        `[${colors.magenta('percy:test:3')}] Debug test 3\n`
      ]);
    });

    it('does not do anything when PERCY_DEBUG is blank', () => {
      process.env.PERCY_DEBUG = ' ';
      helper.mock({ ansi: true });

      logger('test').debug('Debug log');

      expect(logger.loglevel()).toEqual('info');
      expect(helper.stderr).toEqual([]);
    });
  });
});
