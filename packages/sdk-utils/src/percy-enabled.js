import logger from '@percy/logger';
import percy from './percy-info';
import request from './request';

// Create a socket to connect to a remote logger
async function connectRemoteLogger() {
  let url = percy.address.replace('http', 'ws');
  let socket;

  if (process.env.__PERCY_BROWSERIFIED__) {
    socket = new window.WebSocket(url);
  } else {
    socket = new (require('ws'))(url);
    // allow node to exit with an active connection
    socket.once('open', () => socket._socket.unref());
  }

  await logger.remote(socket);
}

// Check if Percy is enabled using the healthcheck endpoint
export default async function isPercyEnabled() {
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
      await connectRemoteLogger().catch(err => {
        log.debug('Unable to connect to remote logger');
        log.debug(err);
      });
    }
  }

  return percy.enabled;
}
