import Command from '@oclif/command';
import PercyConfig from '@percy/config';
import logger from '@percy/logger';

// The PercyCommand class that all Percy CLI commands should extend
// from. Provides common #init() and #catch() methods and provides other methods
// for loading configuration and checking if Percy is enabled.
export default class PercyCommand extends Command {
  log = logger('cli:command');

  //  Initialize flags, args, the loglevel, and attach process handlers to allow
  //  commands to seemlessly cleanup on interupt or termination
  init() {
    let { args, flags } = this.parse();
    this.flags = flags;
    this.args = args;

    // sets the log level from verbose, quiet, and silent flags
    logger.loglevel('info', flags);

    // ensure cleanup is always performed
    let cleanup = () => this.finally(new Error('SIGTERM'));
    process.on('SIGHUP', cleanup);
    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);
  }

  // Log errors using the Percy logger
  async catch(err) {
    try {
      // real errors will bubble
      await super.catch(err);
    } catch (err) {
      // oclif exit method actually throws an error, let it continue
      if (err.oclif && err.code === 'EEXIT') throw err;
      // log all other errors and exit
      this.log.error(err);
      this.exit(1);
    }
  }

  // Returns true or false if Percy has not been disabled
  isPercyEnabled() {
    return process.env.PERCY_ENABLE !== '0';
  }

  // Parses command flags and maps them to config options according to their
  // respective `percyrc` parameter. The flag input is then merged with options
  // loaded from a config file and default config options. The PERCY_TOKEN
  // environment variable is also included as a convenience.
  percyrc(initialOverrides = {}) {
    let flags = Object.entries(this.constructor.flags);
    let overrides = flags.reduce((conf, [name, flag]) => (
      flag.percyrc?.split('.').reduce((target, key, i, paths) => {
        let last = i === paths.length - 1;
        target[key] = last ? this.flags[name] : (target[key] ?? {});
        return last ? conf : target[key];
      }, conf) ?? conf
    ), initialOverrides);

    // will also validate config and log warnings
    let config = PercyConfig.load({
      path: this.flags.config,
      overrides
    });

    // set config: false to prevent core from reloading config
    return Object.assign(config, {
      config: false
    });
  }
}
