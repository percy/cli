import Command, { flags } from '@percy/cli-command';
import { request } from '@percy/core/dist/utils';
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
      let ping = `http://localhost:${port}/percy/healthcheck`;
      await request(ping, { retryNotFound: true, noProxy: true });
      this.log.info('Percy is running');
    } catch (err) {
      this.log.error('Percy is not running');
      this.log.debug(err);
      this.exit(1);
    }
  }
}
