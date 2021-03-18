const logger = require('@percy/logger');
const { ANSI_REG } = require('@percy/logger/dist/util');
const { Logger } = logger;

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

function TestIO(data, options) {
  if (!process.env.__PERCY_BROWSERIFIED__) {
    let { Writable } = require('stream');

    return Object.assign(new Writable(), {
      _write(chunk, encoding, callback) {
        data.push(sanitizeLog(chunk.toString(), options));
        callback();
      }
    });
  }
}

const helpers = {
  constructor: Logger,
  loglevel: logger.loglevel,
  stdout: [],
  stderr: [],

  get messages() {
    return Logger.instance &&
      Logger.instance.messages;
  },

  mock(options) {
    helpers.reset();
    helpers.options = options;

    if (!process.env.__PERCY_BROWSERIFIED__) {
      Logger.stdout = TestIO(helpers.stdout, options);
      Logger.stderr = TestIO(helpers.stderr, options);
    } else {
      let write = Logger.prototype.write;

      if (!write.and) {
        spyOn(Logger.prototype, 'write').and.callFake(function(lvl, msg) {
          let stdio = lvl === 'info' ? 'stdout' : 'stderr';
          helpers[stdio].push(sanitizeLog(msg, helpers.options));
          return write.call(this, lvl, msg);
        });
      }

      if (!console.log.and) {
        spyOn(console, 'log');
        spyOn(console, 'warn');
        spyOn(console, 'error');
      }
    }
  },

  reset() {
    delete Logger.instance;

    helpers.stdout.length = 0;
    helpers.stderr.length = 0;

    if (console.log.and) {
      console.log.calls.reset();
      console.warn.calls.reset();
      console.error.calls.reset();
    }
  },

  dump() {
    if (!helpers.message) return;
    if (console.log.and) console.log.and.callThrough();

    let write = m => process.env.__PERCY_BROWSERIFIED__
      ? console.log(m) : process.stderr.write(`${m}\n`);
    let logs = Array.from(helpers.messages);

    logger.loglevel('debug');

    write(logger.format('--- DUMPING LOGS ---', 'testing', 'warn'));

    logs.reduce((lastlog, { debug, level, message, timestamp }) => {
      write(logger.format(message, debug, level, timestamp - lastlog));
      return timestamp;
    }, logs[0].timestamp);
  }
};

module.exports = helpers;
