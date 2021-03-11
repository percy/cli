const { default: Logger } = (
  process.env.__PERCY_BROWSERIFIED__
    ? require('./browser')
    : require('./logger')
);

function logger(name) {
  return new Logger().group(name);
}

Object.assign(logger, {
  format: (...args) => new Logger().format(...args),
  query: (...args) => new Logger().query(...args),
  connect: (...args) => new Logger().connect(...args),
  remote: (...args) => new Logger().remote(...args),
  loglevel(level, flags = {}) {
    if (flags.verbose) level = 'debug';
    else if (flags.quiet) level = 'warn';
    else if (flags.silent) level = 'silent';
    return new Logger().loglevel(level);
  }
});

Object.defineProperties(logger, {
  stdout: { get: () => Logger.stdout },
  stderr: { get: () => Logger.stderr }
});

module.exports = logger;
module.exports.Logger = Logger;
