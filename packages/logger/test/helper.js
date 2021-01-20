const logger = require('@percy/logger');
const { Writable } = require('stream');

const ANSI_REG = new RegExp([
  '[\\u001B\\u009B][[\\]()#;?]*(?:(?:(?:[a-zA-Z\\d]*(?:;[-a-zA-Z\\d\\/#&.:=?%@~_]*)*)?\\u0007)',
  '(?:(?:\\d{1,4}(?:;\\d{0,4})*)?[\\dA-PR-TZcf-ntqry=><~]))'
].join('|'), 'g');

class TestIO extends Writable {
  data = [];

  constructor({ ansi } = {}) {
    super();
    this.ansi = ansi;
  }

  _write(chunk, encoding, callback) {
    // strip ansi and normalize line endings
    chunk = chunk.toString().replace('\r\n', '\n');
    if (!this.ansi) chunk = chunk.replace(ANSI_REG, '');
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

  logger.instance.messages.forEach(({ debug, level, message }) => {
    process.stderr.write(logger.format(message, debug, level) + '\n');
  });
};

module.exports = logger;
