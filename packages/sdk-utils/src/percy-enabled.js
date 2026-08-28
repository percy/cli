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
      percy.build = response.body.build;
      percy.enabled = true;
      percy.type = response.body.type;
      percy.widths = response.body.widths;
      percy.deviceDetails = response.body.deviceDetails;
    } catch (e) {
      percy.enabled = false;
      error = e;
    }

    // No CLI major-version gate here. The original check (added Oct 2020 with
    // this package) was `version[0] !== 1`, written to refuse the legacy 0.x
    // @percy/agent whose protocol predates /percy/healthcheck. Nothing above 1
    // existed then, so it was meant as a floor but reads as a ceiling: it
    // silently disables snapshots against any CLI 2.x+. The 0.x agent has been
    // gone for years, so the guard protects nothing and only blocks the next
    // major. `percy.version` stays populated for SDKs that want to read it.
    if (!percy.enabled) {
      log.info('Percy is not running, disabling snapshots');
      log.debug(error);
    }
  }

  return percy.enabled;
}

export default isPercyEnabled;
