import expect from 'expect';
import colors from 'colors/safe';
import stdio from './helper';
import log from '..';

describe('logger', () => {
  const label = colors.magenta('percy');

  beforeEach(() => {
    log.loglevel('debug');
  });

  afterEach(() => {
    log.loglevel('error');
  });

  it('formats the message with a percy label', () => {
    stdio.capture(() => log.debug('test'), { ansi: true });
    expect(stdio[1]).toEqual([`[${label}] test\n`]);
  });

  it('formats errors red', () => {
    stdio.capture(() => log.error('error'), { ansi: true });
    expect(stdio[2]).toEqual([`[${label}] ${colors.red('error')}\n`]);
  });

  it('formats warnings yellow', () => {
    stdio.capture(() => log.warn('warning'), { ansi: true });
    expect(stdio[1]).toEqual([`[${label}] ${colors.yellow('warning')}\n`]);
  });

  it('formats info URLs blue', () => {
    let url = 'https://localhost:3000/foobar/baz.png';
    stdio.capture(() => log.info(`url = ${url}`), { ansi: true });
    expect(stdio[1]).toEqual([`[${label}] url = ${colors.blue(url)}\n`]);
  });

  it('adds and formats debug URLs blue', () => {
    let url = 'https://localhost:3000/foobar/baz.png';
    stdio.capture(() => log.debug('debug', { url }), { ansi: true });
    expect(stdio[1]).toEqual([`[${label}] debug: ${colors.blue(url)}\n`]);
  });

  describe('#loglevel()', () => {
    it('sets the first transport log level', () => {
      expect(log.transports[0].level).toBe('debug');
      log.loglevel('info');
      expect(log.transports[0].level).toBe('info');
    });

    it('returns the first transport log level without args', () => {
      expect(log.loglevel()).toBe(log.transports[0].level);
    });

    it('sets the log level to debug with a verbose flag', () => {
      log.loglevel('info', { verbose: true });
      expect(log.loglevel()).toBe('debug');
    });

    it('sets the log level to warn with a quiet flag', () => {
      log.loglevel('info', { quiet: true });
      expect(log.loglevel()).toBe('warn');
    });

    it('sets the log level to silent with a silent flag', () => {
      log.loglevel('info', { silent: true });
      expect(log.loglevel()).toBe('silent');
    });
  });

  describe('#error()', () => {
    it('is patched to log error instance strings', () => {
      log.loglevel('error');
      stdio.capture(() => log.error(new Error('message')));
      expect(stdio[2]).toEqual(['[percy] Error: message\n']);
    });

    it('logs the error instance stack trace in debug', () => {
      let err = new Error('message');
      stdio.capture(() => log.error(err));
      expect(stdio[2]).toEqual([`[percy] ${err.stack}\n`]);
    });

    it('falls back if there is no error instance stack in debug', () => {
      let err = { toString: () => 'error' };
      stdio.capture(() => log.error(err));
      expect(stdio[2]).toEqual(['[percy] error\n']);
    });
  });
});
