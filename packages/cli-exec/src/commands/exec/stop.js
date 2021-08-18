import Command, { flags } from '@percy/cli-command';
import request from '@percy/client/dist/request';
import logger from '@percy/logger';
import execFlags from '../../flags';

export class Stop extends Command {
  static description = 'Stops a local running Percy snapshot server';

  static flags = {
    ...flags.logging,
    ...execFlags
  };

  log = logger('cli:exec:stop');

  async run() {
    let { port } = this.flags;
    let stop = `http://localhost:${port}/percy/stop`;
    let ping = `http://localhost:${port}/percy/healthcheck`;

    if (!this.isPercyEnabled()) {
      this.log.info('Percy is disabled');
      return;
    }

    try {
      await request(stop, { method: 'POST', noProxy: true });
    } catch (err) {
      this.log.error('Percy is not running');
      this.log.debug(err);
      this.exit(1);
    }

    // retry heathcheck until it fails
    await new Promise(function check(resolve) {
      return request(ping, { noProxy: true }).then(() => (
        setTimeout(check, 100, resolve))).catch(resolve);
    });

    this.log.info('Percy has stopped');
  }
}
