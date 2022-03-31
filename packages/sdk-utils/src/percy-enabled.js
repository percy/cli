import logger from '@percy/logger';
import percy from './percy-info.js';
import request from './request.js';

// Create a socket to connect to a remote logger
async function connectRemoteLogger() {
  await logger.remote(async () => {
    let url = percy.address.replace('http', 'ws');

    if (process.env.__PERCY_BROWSERIFIED__) {
      return new window.WebSocket(url);
    } else {
      /* eslint-disable-next-line import/no-extraneous-dependencies */
      let { default: WebSocket } = await import('ws');
      let ws = new WebSocket(url);
      // allow node to exit with an active connection
      return ws.once('open', () => ws._socket.unref());
    }
  });
}

// Check if Percy is enabled using the healthcheck endpoint
export async function isPercyEnabled() {
  if (percy.enabled == null) {
    let log = logger('utils');
    let error;

    try {
      let response = await request('/percy/healthcheck');
      percy.version = response.headers['x-percy-core-version'];
      percy.config = response.body.config;
      percy.enabled = true;
    } catch (e) {
      percy.enabled = false;
      error = e;
    }

    if (percy.enabled && percy.version.major !== 1) {
      log.info('Unsupported Percy CLI version, disabling snapshots');
      log.debug(`Found version: ${percy.version}`);
      percy.enabled = false;
    } else if (!percy.enabled) {
      log.info('Percy is not running, disabling snapshots');
      log.debug(error);
    }

    if (percy.enabled) {
      await connectRemoteLogger();
    }
  }

  return percy.enabled;
}

export default isPercyEnabled;
