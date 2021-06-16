import Command, { flags } from '@percy/cli-command';
import Percy from '@percy/core';
import logger from '@percy/logger';
import spawn from 'cross-spawn';
import which from 'which';
import execFlags from '../../flags';

export class Exec extends Command {
  static description = 'Start and stop Percy around a supplied command';
  static strict = false;

  static flags = {
    ...flags.logging,
    ...flags.discovery,
    ...flags.config,
    ...execFlags,

    parallel: flags.boolean({
      description: 'marks the build as one of many parallel builds'
    }),

    partial: flags.boolean({
      description: 'marks the build as a partial build'
    })
  };

  static examples = [
    '$ percy exec -- echo "percy is running around this echo command"',
    '$ percy exec -- yarn test'
  ];

  log = logger('cli:exec');

  async run() {
    let { argv } = this.parse(Exec);
    let command = argv.shift();

    // validate the passed command
    if (!command) {
      this.log.error('You must supply a command to run after --');
      this.log.info('Example:');
      this.log.info('$ percy exec -- echo "run your test suite"');
      return this.exit(1);
    } else if (!which.sync(command, { nothrow: true })) {
      this.log.error(`Error: command not found "${command}"`);
      return this.exit(127);
    }

    // set environment parallel total for `n` parallel builds (use with build:finalize)
    if (this.flags.parallel && !process.env.PERCY_PARALLEL_TOTAL) {
      process.env.PERCY_PARALLEL_TOTAL = '-1';
    }

    // set environment partial build flag
    if (this.flags.partial) {
      process.env.PERCY_PARTIAL_BUILD = '1';
    }

    // attempt to start percy if enabled
    if (this.isPercyEnabled()) {
      try {
        this.percy = await Percy.start({
          port: this.flags.port,
          ...this.percyrc()
        });
      } catch (err) {
        this.log.info(`Skipping visual tests - ${err.message}`);
      }

      this.log.info(`Running "${[command].concat(argv).join(' ')}"`);
    }

    // provide SDKs with useful env vars
    let env = {
      PERCY_SERVER_ADDRESS: this.percy?.address(),
      PERCY_LOGLEVEL: logger.loglevel(),
      ...process.env
    };

    // run the passed command async
    let status = await new Promise((resolve, reject) => {
      spawn(command, argv, { stdio: 'inherit', env })
        .on('error', reject)
        .on('close', resolve);
    });

    // forward status code
    if (status) {
      this.exit(status);
    }
  }

  // Called on error, interupt, or after running
  async finally(error) {
    await this.percy?.stop(!!error);
  }
}
