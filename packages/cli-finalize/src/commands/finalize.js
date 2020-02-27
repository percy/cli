import Command, { flags } from '@percy/cli-command';
import PercyClient from '@percy/client';
import log from '@percy/logger';

export class Finalize extends Command {
  static description = 'Finalize parallel Percy builds';

  static flags = {
    ...flags.logging
  };

  static examples = [
    '$ percy finalize'
  ];

  async run() {
    if (!this.isPercyEnabled()) {
      log.info('Percy is disabled');
      return;
    }

    let client = new PercyClient();

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
