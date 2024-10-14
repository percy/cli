import Logger from './logger.js';
import TimeIt from './timing.js';

export function logger(name) {
  return new Logger().group(name);
}
const timer = new TimeIt(logger('timer'));

Object.defineProperties(logger, {
  stdout: { get: () => Logger.stdout },
  stderr: { get: () => Logger.stderr },
  constructor: { get: () => Logger },
  instance: { get: () => new Logger() },
  query: { value: (...args) => logger.instance.query(...args) },
  format: { value: (...args) => logger.instance.format(...args) },
  loglevel: { value: (...args) => logger.instance.loglevel(...args) },
  timeit: { get: () => timer },
  measure: { value: (...args) => timer.measure(...args) }
});

export default logger;
