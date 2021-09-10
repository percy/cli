import Command, { flags } from '@percy/cli-command';
import PercyClient from '@percy/client';
import logger from '@percy/logger';
import pkg from '../../../package.json';

export class Finalize extends Command {
  static description = 'Finalize parallel Percy builds where PERCY_PARALLEL_TOTAL=-1';

  static flags = {
    ...flags.logging
  };

  static examples = [
    '$ percy build:finalize'
  ];

  log = logger('cli:build:finalize');

  async run() {
    if (!this.isPercyEnabled()) {
      this.log.info('Percy is disabled');
      return;
    }

    // automatically set parallel total to -1
    if (!process.env.PERCY_PARALLEL_TOTAL) {
      process.env.PERCY_PARALLEL_TOTAL = '-1';
    }

    let client = new PercyClient({
      clientInfo: `${pkg.name}/${pkg.version}`,
      environmentInfo: `node/${process.version}`
    });

    // ensure that this command is not used for other parallel totals
    if (client.env.parallel.total !== -1) {
      this.log.error('This command should only be used with PERCY_PARALLEL_TOTAL=-1');
      this.log.error(`Current value is "${client.env.parallel.total}"`);
      return this.exit(1);
    }

    this.log.info('Finalizing parallel build...');

    // rely on the parallel nonce to cause the API to return the current running build for the nonce
    let { data: build } = await client.createBuild();
    let { 'build-number': number, 'web-url': url } = build.attributes;

    await client.finalizeBuild(build.id, { all: true });
    this.log.info(`Finalized build #${number}: ${url}`);
  }
}
