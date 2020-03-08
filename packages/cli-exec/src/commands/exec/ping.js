import Command, { flags } from '@percy/cli-command';
import { request } from '@percy/client/dist/utils';
import log from '@percy/logger';
import execFlags from '../../flags';

export class Ping extends Command {
  static description = 'Pings a local running Percy snapshot server';

  static flags = {
    ...flags.logging,
    ...execFlags
  };

  async run() {
    try {
      let { port } = this.flags;
      await request(`http://localhost:${port}/percy/healthcheck`, { method: 'GET' });
      log.info('Percy is running');
    } catch (err) {
      log.error('Percy is not running');
      log.debug(err.toString());
      this.exit(1);
    }
  }
}
