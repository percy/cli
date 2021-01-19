import Command, { flags } from '@percy/cli-command';
import Percy from '@percy/core';
import logger from '@percy/logger';
import execFlags from '../../flags';

export class Start extends Command {
  static description = 'Starts a local Percy snapshot server';

  static flags = {
    ...flags.logging,
    ...flags.discovery,
    ...flags.config,
    ...execFlags
  };

  static examples = [
    '$ percy exec:start',
    '$ percy exec:start &> percy.log'
  ];

  log = logger('cli:exec:start');

  async run() {
    if (!this.isPercyEnabled()) {
      this.log.info('Percy has been disabled. Not starting');
      return;
    }

    let percy = await Percy.start({
      port: this.flags.port,
      config: false,
      ...this.percyrc()
    });

    // only stop when terminated
    let stop = () => percy.stop();
    process.on('SIGHUP', stop);
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
  }
}
