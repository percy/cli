import Command, { flags } from '@percy/cli-command';
import PercyClient from '@percy/client';
import log from '@percy/logger';

export class Finalize extends Command {
  static description = 'Finalize parallel Percy builds where PERCY_PARALLEL_TOTAL=-1';

  static flags = {
    ...flags.logging
  };

  static examples = [
    '$ percy build:finalize'
  ];

  async run() {
    if (!this.isPercyEnabled()) {
      log.info('Percy is disabled');
      return;
    }

    // automatically set parallel total to -1
    if (!process.env.PERCY_PARALLEL_TOTAL) {
      process.env.PERCY_PARALLEL_TOTAL = '-1';
    }

    let client = new PercyClient();

    // ensure that this command is not used for other parallel totals
    if (client.env.parallel.total !== -1) {
      log.error('This command should only be used with PERCY_PARALLEL_TOTAL=-1');
      log.error(`Current value is "${client.env.parallel.total}"`);
      return this.exit(1);
    }

    log.info('Finalizing parallel build...');
    await client.createBuild();

    let build = client.build;
    await client.finalizeBuild({ all: true });
    log.info(`Finalized build #${build.number}: ${build.url}`);
  }
}
