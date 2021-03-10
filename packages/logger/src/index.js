const { default: Logger } = (
  process.env.__PERCY_BROWSERIFIED__
    ? require('./browser')
    : require('./logger')
);

function logger(name) {
  return new Logger().group(name);
}

Object.assign(logger, {
  loglevel(level, flags = {}) {
    if (flags.verbose) level = 'debug';
    else if (flags.quiet) level = 'warn';
    else if (flags.silent) level = 'silent';
    return new Logger().loglevel(level);
  },

  format(...args) {
    return new Logger().format(...args);
  },

  query(filter) {
    return new Logger().query(filter);
  }
});

Object.defineProperties(logger, {
  stdout: { get: () => Logger.stdout },
  stderr: { get: () => Logger.stderr }
});

module.exports = logger;
module.exports.Logger = Logger;
