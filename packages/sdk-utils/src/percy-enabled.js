import percy from './percy-info.js';
import request from './request.js';
import logger from './logger.js';

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
      percy.type = response.body.type;
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
  }

  return percy.enabled;
}

export default isPercyEnabled;
