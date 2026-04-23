import logger from '@percy/logger';
import { ANSI_REG } from '@percy/logger/utils';

const ELAPSED_REG = /\s\S*?\(\d+ms\)\S*/;
const NEWLINE_REG = /\r\n/g;
const LASTLINE_REG = /\n$/;

function sanitizeLog(str, { ansi, elapsed } = {}) {
  // normalize line endings
  str = str.replace(NEWLINE_REG, '\n');
  // strip ansi colors
  if (!ansi) str = str.replace(ANSI_REG, '');
  // strip elapsed time
  if (!elapsed) str = str.replace(ELAPSED_REG, '');
  // strip trailing line endings
  return str.replace(LASTLINE_REG, '');
}

function spy(object, method, func) {
  if (object[method].restore) object[method].restore();

  let spy = Object.assign(function spy(...args) {
    spy.calls.push(args);
    if (func) return func.apply(this, args);
  }, {
    restore: () => (object[method] = spy.originalValue),
    reset: () => (spy.calls.length = 0) || spy,
    originalValue: object[method],
    calls: []
  });

  object[method] = spy;
  return spy;
}

const helpers = {
  stdout: [],
  stderr: [],
  loglevel: logger.loglevel,

  get instance() {
    return logger.instance;
  },

  async mock(options = {}) {
    helpers.reset();

    if (options.level) {
      logger.loglevel(options.level);
    }

    if (process.env.__PERCY_BROWSERIFIED__) {
      spy(logger.constructor.prototype, 'write', function(lvl, msg) {
        let stdio = lvl === 'info' ? 'stdout' : 'stderr';
        helpers[stdio].push(sanitizeLog(msg, options));
        return this.write.originalValue.call(this, lvl, msg);
      });

      spy(console, 'log');
      spy(console, 'warn');
      spy(console, 'error');
    } else {
      let { Writable } = await import('stream');

      for (let stdio of ['stdout', 'stderr']) {
        logger.constructor[stdio] = Object.assign(new Writable(), {
          isTTY: options.isTTY,
          columns: options.isTTY ? 100 : null,
          cursorTo() { return true; },
          clearLine() { return true; },
          _write(chunk, encoding, callback) {
            helpers[stdio].push(sanitizeLog(chunk.toString(), options));
            callback();
          }
        });
      }
    }
  },

  // Synchronous hard/soft reset. A hard reset clears the in-memory state
  // and detaches the singleton in the SAME TICK to match pre-PER-7809
  // behavior — async disposal here introduced a gap where logs emitted
  // between ring-clear and singleton-delete would land on the detached
  // instance and go invisible to later logger.query() calls.
  //
  // The detached instance's disk writer + spill directory are reclaimed
  // by the process-exit registry (HybridLogStore keeps itself in
  // activeStores until the process exits) and by the 24h orphan sweep.
  // In-process test-to-test teardown does not need to await IO.
  reset(soft) {
    if (soft) {
      logger.loglevel('info');
    } else {
      const existing = logger.constructor.instance;
      if (existing) {
        // Synchronously clear memory so the detached instance yields nothing
        // to any lingering reference (e.g. percy.log captured the group at
        // Percy construction time; it stays bound to this instance).
        if (typeof existing.clearMemory === 'function') {
          try { existing.clearMemory(); } catch (_) {}
        }
        // Fire-and-forget the disk cleanup so the spill directory is
        // eventually removed without blocking test execution. Errors are
        // swallowed; the process-exit handler is the ultimate backstop.
        if (typeof existing.dispose === 'function') {
          Promise.resolve().then(() => existing.dispose()).catch(() => {});
        }
      }
      delete logger.constructor.instance;
    }

    helpers.stdout.length = 0;
    helpers.stderr.length = 0;

    if (console.log.reset) {
      console.log.reset();
      console.warn.reset();
      console.error.reset();
    }
  },

  dump() {
    let msgs = logger.instance.toArray ? logger.instance.toArray() : [];
    if (!msgs.length) return;

    let log = m => process.env.__PERCY_BROWSERIFIED__ ? (
      console.log.and ? console.log.and.originalFn(m) : console.log(m)
    ) : process.stderr.write(`${m}\n`);

    logger.loglevel('debug');
    log(logger.format('testing', 'warn', '--- DUMPING LOGS ---'));

    msgs.reduce((last, { debug, level, message, timestamp }) => {
      log(logger.format(debug, level, message, timestamp - last));
      return timestamp;
    }, msgs[0].timestamp);
  }
};

export { helpers as logger };
export default helpers;
