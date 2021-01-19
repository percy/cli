import Command, { flags } from '@percy/cli-command';
import { request } from '@percy/client/dist/utils';
import logger from '@percy/logger';
import execFlags from '../../flags';

export class Ping extends Command {
  static description = 'Pings a local running Percy snapshot server';

  static flags = {
    ...flags.logging,
    ...execFlags
  };

  log = logger('cli:exec:ping');

  async run() {
    try {
      let { port } = this.flags;
      await request(`http://localhost:${port}/percy/healthcheck`, { method: 'GET' });
      this.log.info('Percy is running');
    } catch (err) {
      this.log.error('Percy is not running');
      this.log.debug(err);
      this.exit(1);
    }
  }
}
