const os = require('os');
const path = require('path');
const { createLogger, transports, format } = require('winston');
const colors = require('colors/safe');

// A very basic url regexp only used for highlighting URLs blue in the CLI.
const URL_REGEXP = /\b(https?:\/\/)[\w-]+(\.[\w-]+)*(:\d+)?(\/\S*)?\b/gi;
const TEMP_DIR = path.join(os.tmpdir(), 'percy');

// Custom logging formatter to color log levels, insert a megenta label, and
// highlight URLs logged to the transport
function formatter({ label, level, message }) {
  label = colors.magenta(label);

  if (level === 'error') {
    message = colors.red(message);
  } else if (level === 'warn') {
    message = colors.yellow(message);
  } else if (level === 'info') {
    // highlight urls blue
    message = message.replace(URL_REGEXP, colors.blue('$&'));
  }

  return `[${label}] ${message}`;
}

// Global logger
const logger = createLogger({
  transports: [
    // console transport logs errors by default
    new transports.Console({
      level: 'error',
      stderrLevels: ['error'],
      format: format.combine(
        format.label({ label: 'percy' }),
        format.printf(formatter)
      )
    }),
    // file transport logs everything
    new transports.File({
      level: 'debug',
      filename: path.join(TEMP_DIR, `percy.${Date.now()}.log`),
      format: format.combine(
        format.timestamp(),
        format.json()
      )
    })
  ]
});

// Method to change the global logger's console log level. The second argument
// can be used to set the appropriate level based on boolean flags and fallback
// to the provided log level.
logger.loglevel = function loglevel(level, flags = {}) {
  if (!level) return this.transports[0].level;

  if (flags.verbose) level = 'debug';
  else if (flags.quiet) level = 'warn';
  else if (flags.silent) level = 'silent';

  this.transports[0].level = level;
};

// Patch the error method to handle error objects. Winston accepts objects with
// messages and meta as an argument but will fail to log real error instances.
logger.error = function(message) {
  // libraries may also throw errors which are not technically Error instances
  if (typeof message === 'object') {
    // get the stack trace for debug (no ternary to always fallback to string)
    message = (this.loglevel() === 'debug' && message.stack) || message.toString();
  }

  // return super.error(message)
  return this.constructor.prototype.error.call(this, message);
};

module.exports = logger;
