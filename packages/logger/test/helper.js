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

const helper = {
  constructor: Logger,
  loglevel: logger.loglevel,
  stdout: [],
  stderr: [],

  get messages() {
    return Logger.instance?.messages;
  },

  mock(options) {
    helper.reset();
    helper.options = options;

    if (!process.env.__PERCY_BROWSERIFIED__) {
      Logger.stdout = TestIO(helper.stdout, options);
      Logger.stderr = TestIO(helper.stderr, options);
    } else {
      let write = Logger.prototype.write;

      if (!write.and) {
        spyOn(Logger.prototype, 'write').and.callFake(function(lvl, msg) {
          let stdio = lvl === 'info' ? 'stdout' : 'stderr';
          helper[stdio].push(sanitizeLog(msg, helper.options));
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

    helper.stdout.length = 0;
    helper.stderr.length = 0;

    console.log.calls?.reset();
    console.warn.calls?.reset();
    console.error.calls?.reset();
  },

  dump() {
    const write = m => process.env.__PERCY_BROWSERIFIED__
      ? console.log(m) : process.stderr.write(`${m}\n`);

    logger.loglevel('debug');
    write(logger.format('--- DUMPING LOGS ---', 'testing', 'warn'));

    Array.from(helper.messages)
      .reduce((lastlog, { debug, level, message, timestamp }) => {
        let elapsed = timestamp - (lastlog || timestamp);
        write(logger.format(message, debug, level, elapsed));
        return timestamp;
      });
  }
};

module.exports = helper;
