const logger = require('@percy/logger');
const { Writable } = require('stream');

const ANSI_REG = new RegExp([
  '[\\u001B\\u009B][[\\]()#;?]*(?:(?:(?:[a-zA-Z\\d]*(?:;[-a-zA-Z\\d\\/#&.:=?%@~_]*)*)?\\u0007)',
  '(?:(?:\\d{1,4}(?:;\\d{0,4})*)?[\\dA-PR-TZcf-ntqry=><~]))'
].join('|'), 'g');

class TestIO extends Writable {
  data = [];

  constructor({ ansi, elapsed } = {}) {
    super();
    this.ansi = ansi;
    this.elapsed = elapsed;
  }

  _write(chunk, encoding, callback) {
    // normalize line endings
    chunk = chunk.toString().replace('\r\n', '\n');
    // strip ansi colors
    if (!this.ansi) chunk = chunk.replace(ANSI_REG, '');
    // strip elapsed time
    if (!this.elapsed) chunk = chunk.replace(/\s\S*?\(\d+ms\)\S*?\n$/, '\n');

    this.data.push(chunk);
    callback();
  }
}

logger.mock = function mock(options) {
  delete logger.instance;
  logger();

  logger.instance.stdout = new TestIO(options);
  logger.instance.stderr = new TestIO(options);
  logger.stdout = logger.instance.stdout.data;
  logger.stderr = logger.instance.stderr.data;
};

logger.clear = function clear() {
  logger.stdout.length = 0;
  logger.stderr.length = 0;
};

logger.dump = function dump() {
  logger.loglevel('debug');

  process.stderr.write(
    logger.format('--- DUMPING LOGS ---', 'testing', 'warn') + '\n'
  );

  Array.from(logger.instance.messages)
    .reduce((lastlog, { debug, level, message, timestamp }) => {
      let elapsed = timestamp - (lastlog || timestamp);
      process.stderr.write(logger.format(message, debug, level, elapsed) + '\n');
      return timestamp;
    });
};

module.exports = logger;
