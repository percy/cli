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
  loglevel: (...args) => new Logger().loglevel(...args)
});

Object.defineProperties(logger, {
  Logger: { get: () => Logger },
  stdout: { get: () => Logger.stdout },
  stderr: { get: () => Logger.stderr }
});

module.exports = logger;
