import fs, { existsSync, readFileSync, readdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join, sep, dirname } from 'path';
import helpers from './helpers.js';
import { colors } from '@percy/logger/utils';
import logger from '@percy/logger';

// Parameterize the entire suite to run in both store modes — memory mode
// (master parity, fallback Set) and disk mode (production hot path). The
// inner disk-backed-storage describe owns its own env management and runs
// in both wrappers.
['memory', 'disk'].forEach(__mode => {
  describe(`logger (${__mode} mode)`, () => {
    let log, inst;

    beforeEach(async () => {
      if (__mode === 'disk') delete process.env.PERCY_LOGS_IN_MEMORY;
      else process.env.PERCY_LOGS_IN_MEMORY = '1';
      await helpers.mock({ ansi: true, isTTY: true });
      inst = logger.instance;
      log = logger('test');
    });

    afterEach(() => {
      delete process.env.PERCY_LOGLEVEL;
      delete process.env.PERCY_DEBUG;
      delete process.env.PERCY_LOGS_IN_MEMORY;
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
        error: false,
        level,
        message,
        meta
      });

      expect(inst.query(() => true)).toEqual([
        entry('info', 'Info log', { foo: 'bar' }),
        entry('warn', 'Warn log', { bar: 'baz' }),
        entry('error', 'Error log', { to: 'be' }),
        entry('debug', 'Debug log', { not: 'to be' }),
        entry('warn', 'Warning: Deprecation log', { test: 'me' })
      ]);
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
      let url = 'https://percy.io/?foo[bar]=baz&qux=quux:xyzzy;';
      log.info(`URL: ${url}`);

      expect(helpers.stdout).toEqual([
      `[${colors.magenta('percy')}] URL: ${colors.blue(url)}`
      ]);
    });

    it('captures error stack traces without writing them', () => {
      let error = new Error('test');
      log.error(error);

      expect(inst.query(() => true)).toContain({
        debug: 'test',
        level: 'error',
        message: error.stack,
        timestamp: jasmine.any(Number),
        error: true,
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
        meta: { match: true },
        error: false
      }]);
    });

    it('does not write to stdout if CI log', () => {
      log = logger('ci');
      log.info('Dont print me');

      expect(helpers.stdout).toEqual([]);
    });

    it('does not write to stdout if SDK log', () => {
      log = logger('sdk');
      log.info('Dont print me');

      expect(helpers.stdout).toEqual([]);
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

      // does not format leading or trailing newlines
      expect(logger.format('padded', 'debug', '\n\nnewlines\n\n', 25)).toEqual(
      `\n\n[${colors.magenta('percy:padded')}] ` +
        `newlines ${colors.grey('(25ms)')}\n\n`);
    });

    it('exposes own stdout and stderr streams', () => {
      expect(logger.stdout).toBe(logger.constructor.stdout);
      expect(logger.stderr).toBe(logger.constructor.stderr);
    });

    it('can define a custom instance write method', () => {
      let write = logger.instance.write = jasmine.createSpy('write');

      log.info('Info log');
      log.warn('Warn log');
      log.error('Error log');
      log.debug('Debug log');

      expect(write).toHaveBeenCalledWith(jasmine.objectContaining(
        { debug: 'test', level: 'info', message: 'Info log' }));
      expect(write).toHaveBeenCalledWith(jasmine.objectContaining(
        { debug: 'test', level: 'warn', message: 'Warn log' }));
      expect(write).toHaveBeenCalledWith(jasmine.objectContaining(
        { debug: 'test', level: 'error', message: 'Error log' }));

      // write is not called when a log should not be written
      expect(write).not.toHaveBeenCalledWith(jasmine.objectContaining(
        { debug: 'test', level: 'debug', message: 'Debug log' }));

      log.loglevel('debug');
      log.debug('Debug log');

      expect(write).toHaveBeenCalledWith(jasmine.objectContaining(
        { debug: 'test', level: 'debug', message: 'Debug log' }));
    });

    describe('levels', () => {
      it('can be initially set by defining PERCY_LOGLEVEL', () => {
        helpers.reset();
        process.env.PERCY_LOGLEVEL = 'error';
        expect(logger.loglevel()).toEqual('error');
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
        let errorlike = { name: 'Foo', message: 'bar' };
        let errorstr = { toString: () => 'ERROR' };
        log.loglevel('debug');
        log.debug(errorlike);
        log.debug(errorstr);

        expect(helpers.stderr).toEqual([
        `[${colors.magenta('percy:test')}] ${colors.red('Foo: bar')}`,
        `[${colors.magenta('percy:test')}] ${colors.red('ERROR')}`
        ]);
      });

      it('logs elapsed time when loglevel is "debug"', async () => {
        await helpers.mock({ elapsed: true });
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

      it('enables debug logging when PERCY_DEBUG is defined', async () => {
        process.env.PERCY_DEBUG = '*';
        await helpers.mock({ ansi: true, isTTY: true });

        logger('test').debug('Debug log');

        expect(logger.loglevel()).toEqual('debug');
        expect(helpers.stderr).toEqual([
        `[${colors.magenta('percy:test')}] Debug log`
        ]);
      });

      it('filters specific logs for debugging', async () => {
        process.env.PERCY_DEBUG = 'test:*,-test:2,';
        await helpers.mock({ ansi: true });

        logger('test').debug('Debug test');
        logger('test:1').debug('Debug test 1');
        logger('test:2').debug('Debug test 2');
        logger('test:3').debug('Debug test 3');

        expect(helpers.stderr).toEqual([
          '[percy:test] Debug test',
          '[percy:test:1] Debug test 1',
          '[percy:test:3] Debug test 3'
        ]);
      });

      it('does not do anything when PERCY_DEBUG is blank', async () => {
        process.env.PERCY_DEBUG = ' ';
        await helpers.mock({ ansi: true });

        logger('test').debug('Debug log');

        expect(logger.loglevel()).toEqual('info');
        expect(helpers.stderr).toEqual([]);
      });
    });

    describe('progress', () => {
      let stdout;

      let resetSpies = () => {
        stdout.cursorTo.calls.reset();
        stdout.clearLine.calls.reset();
        stdout.write.calls.reset();
      };

      beforeEach(async () => {
        spyOn(logger.stdout, 'cursorTo').and.callThrough();
        spyOn(logger.stdout, 'clearLine').and.callThrough();
        spyOn(logger.stdout, 'write').and.callThrough();
        ({ stdout } = logger);
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
        expect(stdout.clearLine).toHaveBeenCalledWith(0);
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
        expect(stdout.clearLine).toHaveBeenCalledWith(0);
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
          expect(stdout.write).toHaveBeenCalledWith('[percy] foo\n');
          expect(stdout.clearLine).not.toHaveBeenCalled();
        });

        it('does not replace progress with the next log', () => {
          log.progress('foo');
          resetSpies();

          log.info('bar');

          expect(stdout.cursorTo).not.toHaveBeenCalled();
          expect(stdout.clearLine).not.toHaveBeenCalled();
          expect(stdout.write).toHaveBeenCalledWith('[percy] bar\n');
        });

        it('ignores consecutive persistant logs after the first', () => {
          log.progress('foo', true);
          log.info('bar');
          log.progress('baz', true);
          log.info('qux');

          expect(stdout.cursorTo).not.toHaveBeenCalled();
          expect(stdout.write).toHaveBeenCalledTimes(3);
          expect(stdout.write).toHaveBeenCalledWith('[percy] foo\n');
          expect(stdout.write).toHaveBeenCalledWith('[percy] bar\n');
          expect(stdout.write).not.toHaveBeenCalledWith('[percy] baz\n');
          expect(stdout.write).toHaveBeenCalledWith('[percy] qux\n');
          expect(stdout.clearLine).not.toHaveBeenCalled();
        });
      });
    });

    describe('timeit', () => {
      describe('measure', () => {
        it('should execute async callback and log duration', async () => {
          const date1 = new Date(2024, 4, 11, 13, 30, 0);
          const date2 = new Date(2024, 4, 11, 13, 31, 0);
          const meta = { abc: '123' };
          // Logger internally calls Date.now, so need to mock
          // response for it as well.
          spyOn(Date, 'now').and.returnValues(date1, date1, date2, date1);
          const callback = async () => {
            await new Promise((res, _) => setTimeout(res, 20));
            log.info('abcd');
            return 10;
          };

          logger.loglevel('debug');
          const ret = await logger.measure('step', 'test', meta, callback);
          expect(ret).toEqual(10);
          expect(helpers.stdout).toEqual([
            jasmine.stringContaining(`[${colors.magenta('percy:test')}] abcd`)
          ]);
          expect(helpers.stderr).toEqual([
          `[${colors.magenta('percy:timer')}] step - test - 60s`
          ]);
        });

        it('should execute sync callback and log duration', () => {
          const date1 = new Date(2024, 4, 11, 13, 30, 0);
          const date2 = new Date(2024, 4, 11, 13, 31, 0);
          const meta = { abc: '123' };
          // Logger internally calls Date.now, so need to mock
          // response for it as well.
          spyOn(Date, 'now').and.returnValues(date1, date1, date2, date1);
          const callback = () => { log.info('abcd'); return 10; };

          logger.loglevel('debug');
          const ret = logger.measure('step', 'test', meta, callback);
          expect(ret).toEqual(10);
          expect(helpers.stdout).toEqual([
            jasmine.stringContaining(`[${colors.magenta('percy:test')}] abcd`)
          ]);
          expect(helpers.stderr).toEqual([
          `[${colors.magenta('percy:timer')}] step - test - 60s`
          ]);
        });

        it('should capture error info in async', async () => {
          const meta = { abc: '123' };
          const error = new Error('Error');
          const callback = async () => { log.info('abcd'); throw error; };

          logger.loglevel('debug');
          try {
            await logger.measure('step', 'test1', meta, callback);
          } catch (e) {
            expect(e).toEqual(error);
          }
          expect(helpers.stdout).toEqual([
            jasmine.stringContaining(`[${colors.magenta('percy:test')}] abcd`)
          ]);
          const mlog = logger.instance.query((msg => msg.debug === 'timer'))[0];
          expect(mlog.meta.errorMsg).toEqual('Error');
          expect(mlog.meta.errorStack).toEqual(jasmine.stringContaining('Error: Error'));
        });

        it('should capture error info in sync', () => {
          const meta = { abc: '123' };
          const error = new Error('Error');
          const callback = () => { log.info('abcd'); throw error; };

          logger.loglevel('debug');
          try {
            logger.measure('step', 'test1', meta, callback);
          } catch (e) {
            expect(e).toEqual(error);
          }
          expect(helpers.stdout).toEqual([
            jasmine.stringContaining(`[${colors.magenta('percy:test')}] abcd`)
          ]);
          const mlog = logger.instance.query((msg => msg.debug === 'timer'))[0];
          expect(mlog.meta.errorMsg).toEqual('Error');
          expect(mlog.meta.errorStack).toEqual(jasmine.stringContaining('Error: Error'));
        });
      });
    });

    describe('disk-backed storage', () => {
      let percyLogsDir = join(tmpdir(), 'percy-logs', String(process.pid));

      beforeEach(async () => {
        delete process.env.PERCY_LOGS_IN_MEMORY;
        try { rmSync(percyLogsDir, { recursive: true, force: true }); } catch { /* tolerate */ }
        await helpers.mock();
        delete process.env.PERCY_LOGS_IN_MEMORY;
        logger.instance.reset();
      });

      afterEach(() => {
        logger.instance.reset();
        try { rmSync(percyLogsDir, { recursive: true, force: true }); } catch { /* tolerate */ }
      });

      it('round-trips entries through disk', () => {
        let group = logger('disk');
        for (let i = 0; i < 50; i++) group.info(`entry ${i}`, { i });

        let entries = logger.query(() => true);
        expect(entries.length).toEqual(50);
        expect(entries[0]).toEqual(jasmine.objectContaining({ message: 'entry 0', meta: { i: 0 } }));
        expect(entries[49]).toEqual(jasmine.objectContaining({ message: 'entry 49', meta: { i: 49 } }));
      });

      it('writes a JSONL file under percy-logs', () => {
        logger('disk').info('hello');
        logger.query(() => true); // forces flush

        let files = readdirSync(percyLogsDir).filter(f => f.endsWith('.jsonl'));
        expect(files.length).toEqual(1);
        let content = readFileSync(join(percyLogsDir, files[0]), 'utf8');
        let line = content.trim().split('\n')[0];
        expect(JSON.parse(line)).toEqual(jasmine.objectContaining({
          debug: 'disk', level: 'info', message: 'hello', error: false
        }));
      });

      it('serves snapshotLogs from in-memory cache, not disk', () => {
        let group = logger('core:snapshot');
        group.info('A1', { snapshot: { testCase: 'tc', name: 'A' } });
        group.info('B1', { snapshot: { testCase: 'tc', name: 'B' } });
        group.info('A2', { snapshot: { testCase: 'tc', name: 'A' } });

        let logsA = logger.snapshotLogs({ testCase: 'tc', name: 'A' });
        expect(logsA.length).toEqual(2);
        expect(logsA.map(l => l.message)).toEqual(['A1', 'A2']);

        let logsB = logger.snapshotLogs({ testCase: 'tc', name: 'B' });
        expect(logsB.length).toEqual(1);
        expect(logsB[0].message).toEqual('B1');
      });

      it('on retry after evictSnapshot, snapshotLogs returns BOTH attempts (master parity)', () => {
        let group = logger('core:snapshot');
        group.info('A1', { snapshot: { testCase: 'tc', name: 'A' } });

        // first attempt: upload happens and the snapshot is evicted
        expect(logger.snapshotLogs({ testCase: 'tc', name: 'A' }).map(l => l.message))
          .toEqual(['A1']);
        logger.evictSnapshot({ testCase: 'tc', name: 'A' });

        // retry: discovery re-snapshots the same meta and logs again
        group.info('A2 (retry)', { snapshot: { testCase: 'tc', name: 'A' } });

        // snapshotLogs must surface BOTH attempts so the per-snapshot log
        // resource is complete — master's `messages = new Set()` retained
        // every entry; the disk path mirrors that via a one-shot full-disk
        // rescan triggered by the pendingFullScan mark.
        let logsA = logger.snapshotLogs({ testCase: 'tc', name: 'A' });
        expect(logsA.map(l => l.message)).toEqual(['A1', 'A2 (retry)']);
        expect(logger.query(() => true).find(e => e.message === 'A2 (retry)')).toBeDefined();
      });

      it('snapshotLogs returns a fresh array — caller push/splice does not corrupt cache', () => {
        let group = logger('core:snapshot');
        group.info('m1', { snapshot: { testCase: 'tc', name: 'M' } });
        group.info('m2', { snapshot: { testCase: 'tc', name: 'M' } });

        let first = logger.snapshotLogs({ testCase: 'tc', name: 'M' });
        first.push({ message: 'INJECTED' });
        first.splice(0, 1);

        let second = logger.snapshotLogs({ testCase: 'tc', name: 'M' });
        expect(second.length).toEqual(2);
        expect(second.map(l => l.message)).toEqual(['m1', 'm2']);
      });

      it('snapshotKey separator does not collide on names containing "|"', () => {
        let group = logger('core:snapshot');
        group.info('first', { snapshot: { testCase: 'a|b', name: 'c' } });
        group.info('second', { snapshot: { testCase: 'a', name: 'b|c' } });

        expect(logger.snapshotLogs({ testCase: 'a|b', name: 'c' }).map(l => l.message))
          .toEqual(['first']);
        expect(logger.snapshotLogs({ testCase: 'a', name: 'b|c' }).map(l => l.message))
          .toEqual(['second']);
      });

      it('snapshotLogs returns [] for an unknown key', () => {
        logger('core:snapshot').info('m1', { snapshot: { name: 'A' } });
        expect(logger.snapshotLogs({ name: 'unknown' })).toEqual([]);
      });

      it('evictSnapshot then snapshotLogs for a key with no disk entries returns []', () => {
        // evict a meta we never logged for — pendingFullScan triggers, _scanDisk
        // returns nothing, snapshotLogs returns [] (no spurious cache entry).
        logger.evictSnapshot({ name: 'never-logged' });
        expect(logger.snapshotLogs({ name: 'never-logged' })).toEqual([]);
      });

      it('memory-mode fallbackByKey lazy build groups multiple entries per key', () => {
        process.env.PERCY_LOGS_IN_MEMORY = '1';
        delete logger.constructor.instance;

        let group = logger('mem:lazy');
        // Pre-populate fallback with multiple entries for the SAME key plus
        // an untagged entry — exercises the lazy-build branches:
        //   - !k continue (untagged)
        //   - !arr first set
        //   - arr already exists, just push
        group.info('a1', { snapshot: { name: 'A' } });
        group.info('a2', { snapshot: { name: 'A' } });
        group.info('plain'); // no snapshot meta

        // First snapshotLogs call triggers lazy build
        expect(logger.snapshotLogs({ name: 'A' }).map(l => l.message)).toEqual(['a1', 'a2']);
      });

      it('memory-mode snapshotLogs returns [] for an unknown key after lazy build', () => {
        process.env.PERCY_LOGS_IN_MEMORY = '1';
        delete logger.constructor.instance;

        logger('mem:miss').info('m1', { snapshot: { name: 'present' } });

        // build the index then ask for a key it doesn't contain
        expect(logger.snapshotLogs({ name: 'absent' })).toEqual([]);
      });

      it('memory-mode index update — incremental _record path with and without meta', () => {
        process.env.PERCY_LOGS_IN_MEMORY = '1';
        delete logger.constructor.instance;

        let group = logger('mem:inc');
        group.info('a1', { snapshot: { name: 'A' } });
        // build the index
        expect(logger.snapshotLogs({ name: 'A' }).map(l => l.message)).toEqual(['a1']);

        // incremental updates: existing key, new key, untagged
        group.info('a2', { snapshot: { name: 'A' } });
        group.info('b1', { snapshot: { name: 'B' } });
        group.info('untagged');

        expect(logger.snapshotLogs({ name: 'A' }).map(l => l.message)).toEqual(['a1', 'a2']);
        expect(logger.snapshotLogs({ name: 'B' }).map(l => l.message)).toEqual(['b1']);
      });

      it('evictSnapshot drops the cache but disk + retry rescan still surface the entries', () => {
        let group = logger('core:snapshot');
        group.info('hi', { snapshot: { testCase: 'tc', name: 'A' } });

        expect(logger.snapshotLogs({ testCase: 'tc', name: 'A' }).length).toEqual(1);
        logger.evictSnapshot({ testCase: 'tc', name: 'A' });

        // The next snapshotLogs() call after evict triggers the retry-path
        // full rescan and recovers the pre-eviction entry. This mirrors
        // master's `messages` Set retain-everything behavior.
        expect(logger.snapshotLogs({ testCase: 'tc', name: 'A' }).map(l => l.message))
          .toEqual(['hi']);

        // and disk still has it for sendBuildLogs to query
        expect(logger.query(() => true).find(e => e.message === 'hi')).toBeDefined();
      });

      it('flushes the buffer when query is called', () => {
      // 5 entries; below the 500 size cap and faster than the 100ms timer.
        let group = logger('disk');
        for (let i = 0; i < 5; i++) group.info(`x${i}`);

        // query forces a flush, so entries become visible on disk
        let result = logger.query(() => true);
        expect(result.length).toEqual(5);
      });

      it('reset() clears state and removes the disk file', () => {
        logger('disk').info('temporary');
        logger.query(() => true);

        let files = readdirSync(percyLogsDir).filter(f => f.endsWith('.jsonl'));
        expect(files.length).toEqual(1);
        let path = join(percyLogsDir, files[0]);
        expect(existsSync(path)).toBeTrue();

        logger.instance.reset();
        expect(existsSync(path)).toBeFalse();
        expect(logger.query(() => true).length).toEqual(0);
      });

      it('survives circular references in meta', () => {
        let circular = {};
        circular.self = circular;
        logger('disk').error('round and round', { circle: circular });

        let entries = logger.query(() => true);
        expect(entries.length).toEqual(1);
        expect(entries[0].meta).toEqual({ unserializable: true });
      });

      it('preserves snapshot key when meta has circular references', () => {
        let circular = {};
        circular.self = circular;
        logger('disk').error('boom', { snapshot: { name: 'A' }, circle: circular });

        // The entry should still route to snapshotLogs even after meta sanitization.
        let logs = logger.snapshotLogs({ name: 'A' });
        expect(logs.length).toEqual(1);
        expect(logs[0].meta).toEqual({ unserializable: true, snapshot: { name: 'A' } });
      });

      it('falls back to in-memory mode when PERCY_LOGS_IN_MEMORY=1', () => {
        logger.instance.reset();
        process.env.PERCY_LOGS_IN_MEMORY = '1';
        // force a fresh instance so the env is re-read
        delete logger.constructor.instance;

        logger('mem').info('no disk for me');

        let files;
        try { files = readdirSync(percyLogsDir).filter(f => f.endsWith('.jsonl')); } catch { files = []; }
        expect(files.length).toEqual(0);

        let entries = logger.query(() => true);
        expect(entries.length).toEqual(1);
        expect(entries[0].message).toEqual('no disk for me');
      });

      it('snapshotLogs filters from the in-memory Set in memory mode', () => {
        logger.instance.reset();
        process.env.PERCY_LOGS_IN_MEMORY = '1';
        delete logger.constructor.instance;

        let group = logger('core:snapshot');
        group.info('A1', { snapshot: { testCase: 'tc', name: 'A' } });
        group.info('B1', { snapshot: { testCase: 'tc', name: 'B' } });
        group.info('untagged');

        // First call: mode is still 'disk' at entry, _flushSync flips it to memory.
        let logsA = logger.snapshotLogs({ testCase: 'tc', name: 'A' });
        expect(logsA.length).toEqual(1);
        expect(logsA[0].message).toEqual('A1');

        // Add another tagged entry — goes directly into the fallback Set now.
        group.info('A2', { snapshot: { testCase: 'tc', name: 'A' } });

        // Second call: mode is 'memory' at entry — covers the top-of-method memory branch.
        let logsA2 = logger.snapshotLogs({ testCase: 'tc', name: 'A' });
        expect(logsA2.length).toEqual(2);

        // also covers the top-of-method memory branch in query()
        let all = logger.query(() => true);
        expect(all.length).toEqual(4);

        // empty meta returns []
        expect(logger.snapshotLogs({}).length).toEqual(0);
      });

      it('falls back to memory when appendFileSync throws', () => {
        let calls = 0;
        let real = fs.appendFileSync;
        let spy = spyOn(fs, 'appendFileSync').and.callFake((...args) => {
          calls++;
          if (calls === 1) throw Object.assign(new Error('ENOSPC'), { code: 'ENOSPC' });
          return real.apply(fs, args);
        });

        logger('disk').info('first entry');
        // forces a flush, which triggers the appendFileSync failure
        let entries = logger.query(() => true);

        expect(spy).toHaveBeenCalled();
        expect(entries.length).toEqual(1);
        expect(entries[0].message).toEqual('first entry');
        // after fallback, no disk file should exist
        let files = [];
        try { files = readdirSync(percyLogsDir); } catch { /* ok */ }
        expect(files.filter(f => f.endsWith('.jsonl')).length).toEqual(0);
      });

      it('falls back to memory when mkdirSync throws', () => {
        spyOn(fs, 'mkdirSync').and.throwError(Object.assign(new Error('EACCES'), { code: 'EACCES' }));

        logger('disk').info('cannot create dir');
        let entries = logger.query(() => true);

        expect(entries.length).toEqual(1);
        expect(entries[0].message).toEqual('cannot create dir');
      });

      it('drains pre-fallback buffer entries into memory', () => {
        spyOn(fs, 'appendFileSync').and.callFake(() => {
          throw Object.assign(new Error('ENOSPC'), { code: 'ENOSPC' });
        });

        let group = logger('disk');
        group.info('one');
        group.info('two');
        group.info('three');

        let entries = logger.query(() => true);
        expect(entries.length).toEqual(3);
        expect(entries.map(e => e.message)).toEqual(['one', 'two', 'three']);
      });

      it('reads existing disk content into memory when fallback fires mid-build', () => {
        let original = fs.appendFileSync;
        let failAfter = 1;
        let calls = 0;
        spyOn(fs, 'appendFileSync').and.callFake((...args) => {
          calls++;
          if (calls > failAfter) throw Object.assign(new Error('ENOSPC'), { code: 'ENOSPC' });
          return original.apply(fs, args);
        });

        let group = logger('disk');
        group.info('on disk');
        logger.query(() => true); // flush #1 — succeeds, on disk

        group.info('after fallback');
        let entries = logger.query(() => true); // flush #2 — fails, fallback fires

        expect(entries.length).toEqual(2);
        expect(entries.map(e => e.message).sort()).toEqual(['after fallback', 'on disk']);
      });

      it('evictSnapshot with empty meta is a no-op', () => {
        logger.instance.evictSnapshot({});
        logger.instance.evictSnapshot();
        expect(logger.query(() => true).length).toEqual(0);
      });

      it('snapshotKey works with only name or only testCase set', () => {
        let group = logger('partial');
        group.info('only-name', { snapshot: { name: 'A' } });
        group.info('only-testcase', { snapshot: { testCase: 'tc' } });
        group.info('both', { snapshot: { testCase: 'tc', name: 'A' } });

        expect(logger.snapshotLogs({ name: 'A' }).length).toEqual(1);
        expect(logger.snapshotLogs({ testCase: 'tc' }).length).toEqual(1);
        expect(logger.snapshotLogs({ testCase: 'tc', name: 'A' }).length).toEqual(1);
      });

      it('query filter rejects non-matching entries', () => {
        let g = logger('disk');
        g.info('keep-me');
        g.info('drop-me');
        let kept = logger.query(e => e.message === 'keep-me');
        expect(kept.length).toEqual(1);
        expect(kept[0].message).toEqual('keep-me');
      });

      it('logger.reset() (public wrapper) clears the logger', () => {
        logger('disk').info('temporary');
        expect(logger.query(() => true).length).toEqual(1);
        logger.reset();
        expect(logger.query(() => true).length).toEqual(0);
      });

      it('the 100ms timer flushes the buffer on its own', async () => {
        logger('timer').info('lazy');
        // Wait past the FLUSH_TIMER_MS window so the timer callback fires
        // without us forcing a flush via query().
        await new Promise(r => setTimeout(r, 150));
        // Now query() should find the entry already on disk; the buffer is
        // empty, so no extra flush happens here.
        expect(logger.query(() => true).length).toEqual(1);
      });

      it('auto-flushes when the buffer hits the entry cap', () => {
        let group = logger('cap');
        // FLUSH_AT_ENTRIES = 500. Push more than that to trigger the size-cap flush.
        for (let i = 0; i < 510; i++) group.info(`x${i}`);
        let entries = logger.query(() => true);
        expect(entries.length).toEqual(510);
      });

      it('skips untagged entries while building the snapshot cache from disk', () => {
        let group = logger('mix');
        group.info('untagged-1');
        group.info('tagged-1', { snapshot: { name: 'A' } });
        group.info('untagged-2');
        // first snapshotLogs call triggers cache build from disk delta
        let logsA = logger.snapshotLogs({ name: 'A' });
        expect(logsA.length).toEqual(1);
        expect(logsA[0].message).toEqual('tagged-1');
      });

      it('disk-fail warning falls back to err.message when no code is present', () => {
        let warnSpy = jasmine.createSpy('write');
        let originalStderr = logger.constructor.stderr;
        logger.constructor.stderr = { write: warnSpy };

        spyOn(fs, 'appendFileSync').and.throwError(new Error('something broke'));

        logger('msg').info('one');
        logger.query(() => true);

        logger.constructor.stderr = originalStderr;
        expect(warnSpy.calls.allArgs().some(a => /something broke/.test(a[0]))).toBeTrue();
      });

      it('disk-fail warning shows "unknown" when err has neither code nor message', () => {
        let warnSpy = jasmine.createSpy('write');
        let originalStderr = logger.constructor.stderr;
        logger.constructor.stderr = { write: warnSpy };

        // bare object — no .code, no .message — exercises the 'unknown' branch
        // eslint-disable-next-line no-throw-literal
        spyOn(fs, 'appendFileSync').and.callFake(() => { throw {}; });

        logger('unk').info('one');
        logger.query(() => true);

        logger.constructor.stderr = originalStderr;
        expect(warnSpy.calls.allArgs().some(a => /\(unknown\)/.test(a[0]))).toBeTrue();
      });

      it('fires the disk-write-failed stderr warning exactly once', () => {
        let warnSpy = jasmine.createSpy('write');
        let originalStderr = logger.constructor.stderr;
        logger.constructor.stderr = { write: warnSpy };

        spyOn(fs, 'appendFileSync').and.throwError(Object.assign(new Error('ENOSPC'), { code: 'ENOSPC' }));

        logger('warn1').info('one');
        logger.query(() => true);
        logger('warn2').info('two');
        logger.query(() => true);

        logger.constructor.stderr = originalStderr;
        expect(warnSpy.calls.allArgs().filter(a => /disk write failed/.test(a[0])).length).toEqual(1);
      });

      it('cleans up the disk file when the process exit hook fires', () => {
        logger('exit').info('hello');
        logger.query(() => true); // ensure file exists
        let files = readdirSync(percyLogsDir).filter(f => f.endsWith('.jsonl'));
        expect(files.length).toEqual(1);
        let path = join(percyLogsDir, files[0]);

        // Manually invoke the registered exit listener — simulating process.emit('exit')
        // would also fire other test-suite listeners which we don't want.
        let listeners = process.listeners('exit');
        for (let listener of listeners.slice(-1)) listener();

        expect(existsSync(path)).toBeFalse();
      });

      it('writes the JSONL into the per-pid subdir', () => {
        logger('pid').info('one');
        logger.query(() => true);

        let pidDir = join(tmpdir(), 'percy-logs', String(process.pid));
        let files = readdirSync(pidDir).filter(f => f.endsWith('.jsonl'));
        expect(files.length).toEqual(1);
        // diskPath itself sits under the pid subdir
        expect(logger.instance.diskPath.includes(`${sep}${process.pid}${sep}`)).toBeTrue();
      });

      it('process[Symbol.for(@percy/logger.exitHooksInstalled)] is the dedupe latch', () => {
        logger('latch').info('one');
        logger.query(() => true);
        expect(process[Symbol.for('@percy/logger.exitHooksInstalled')]).toBeTrue();
        // Active-instance Set holds the live logger, so it survives module reloads
        expect(process[Symbol.for('@percy/logger.activeInstances')].has(logger.instance)).toBeTrue();
      });

      it('exit-hook cleanup iterates every active logger instance', () => {
      // The current singleton + a sibling instance held off-thread (we can't
      // construct two live PercyLogger via the singleton getter, so we add
      // a stub directly to the active set to mirror the multi-instance case).
        logger('a').info('one');
        logger.query(() => true);
        let firstPath = logger.instance.diskPath;

        let stub = {
          diskPath: join(percyLogsDir, '99999-stub.jsonl'),
          _flushSync() {},
          _cleanup: logger.constructor.prototype._cleanup
        };
        // create the stub's file so we can verify cleanup unlinks it
        fs.writeFileSync(stub.diskPath, '');
        process[Symbol.for('@percy/logger.activeInstances')].add(stub);

        let listeners = process.listeners('exit');
        for (let listener of listeners.slice(-1)) listener();

        expect(existsSync(firstPath)).toBeFalse();
        expect(existsSync(stub.diskPath)).toBeFalse();
        // tidy up our manual injection
        process[Symbol.for('@percy/logger.activeInstances')].delete(stub);
      });

      it('rmdir best-effort tolerates a non-empty pid subdir', () => {
        logger('rm').info('hi');
        logger.query(() => true);
        let diskPath = logger.instance.diskPath;
        let pidDir = dirname(diskPath);
        // peer file in the same pid subdir
        let peer = join(pidDir, 'peer.txt');
        fs.writeFileSync(peer, 'peer');

        logger.instance.reset();

        // peer survived because rmdir is best-effort and the dir is non-empty
        expect(existsSync(peer)).toBeTrue();
        // our jsonl is gone
        expect(existsSync(diskPath)).toBeFalse();
        fs.unlinkSync(peer);
      });
    });

    describe('PERCY_LOGLEVEL', () => {
      it('honors the env var on construction', () => {
        delete logger.constructor.instance;
        process.env.PERCY_LOGLEVEL = 'error';
        expect(logger.loglevel()).toEqual('error');
        delete process.env.PERCY_LOGLEVEL;
      });
    });
  });
});
