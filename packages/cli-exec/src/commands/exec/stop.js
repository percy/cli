import Command, { flags } from '@percy/cli-command';
import { request } from '@percy/client/dist/utils';
import log from '@percy/logger';
import execFlags from '../../flags';

export class Stop extends Command {
  static description = 'Stops a local running Percy snapshot server';

  static flags = {
    ...flags.logging,
    ...execFlags
  };

  async run() {
    if (!this.isPercyEnabled()) {
      log.info('Percy is disabled');
      return;
    }

    try {
      let { port } = this.flags;
      await request(`http://localhost:${port}/percy/stop`, { method: 'POST' });
      log.info('Percy has stopped');
    } catch (err) {
      log.error('Percy is not running');
      log.debug(err);
      this.exit(1);
    }
  }
}
