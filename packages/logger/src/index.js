const Logger = require('./logger').default;

function logger(name) {
  logger.instance ||= new Logger();
  return logger.instance.group(name);
}

logger.loglevel = function loglevel(level, flags = {}) {
  logger.instance ||= new Logger();
  if (!level) return logger.instance.loglevel();
  if (flags.verbose) level = 'debug';
  else if (flags.quiet) level = 'warn';
  else if (flags.silent) level = 'silent';
  return logger.instance.loglevel(level);
};

logger.format = function format(...args) {
  logger.instance ||= new Logger();
  return logger.instance.format(...args);
};

logger.query = function query(filter) {
  logger.instance ||= new Logger();
  return logger.instance.query(filter);
};

module.exports = logger;
