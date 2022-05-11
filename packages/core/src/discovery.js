import mime from 'mime-types';
import logger from '@percy/logger';
import { request as makeRequest } from '@percy/client/utils';
import { normalizeURL, hostnameMatches, createResource } from './utils.js';

const MAX_RESOURCE_SIZE = 15 * (1024 ** 2); // 15MB
const ALLOWED_STATUSES = [200, 201, 301, 302, 304, 307, 308];
const ALLOWED_RESOURCES = ['Document', 'Stylesheet', 'Image', 'Media', 'Font', 'Other'];

export function createRequestHandler(network, { disableCache, disallowedHostnames, getResource }) {
  let log = logger('core:discovery');

  return async request => {
    let url = request.url;
    let meta = { ...network.meta, url };

    try {
      log.debug(`Handling request: ${url}`, meta);
      let resource = getResource(url);

      if (resource?.root) {
        log.debug('- Serving root resource', meta);
        await request.respond(resource);
      } else if (hostnameMatches(disallowedHostnames, url)) {
        log.debug('- Skipping disallowed hostname', meta);
        await request.abort(true);
      } else if (resource && !disableCache) {
        log.debug('- Resource cache hit', meta);
        await request.respond(resource);
      } else {
        await request.continue();
      }
    } catch (error) {
      log.debug(`Encountered an error handling request: ${url}`, meta);
      log.debug(error);

      /* istanbul ignore next: race condition */
      await request.abort(error)
        .catch(e => log.debug(e, meta));
    }
  };
}

export function createRequestFinishedHandler(network, {
  enableJavaScript,
  allowedHostnames,
  disableCache,
  getResource,
  saveResource
}) {
  let log = logger('core:discovery');

  return async request => {
    let origin = request.redirectChain[0] || request;
    let url = normalizeURL(origin.url);
    let meta = { ...network.meta, url };

    try {
      let resource = getResource(url);

      // process and cache the response and resource
      if (!resource?.root && (!resource || disableCache)) {
        let response = request.response;
        let capture = response && hostnameMatches(allowedHostnames, url);
        let body = capture && await response.buffer();

        log.debug(`Processing resource: ${url}`, meta);

        /* istanbul ignore next: sanity check */
        if (!response) {
          return log.debug('- Skipping no response', meta);
        } else if (!capture) {
          return log.debug('- Skipping remote resource', meta);
        } else if (!body.length) {
          return log.debug('- Skipping empty response', meta);
        } else if (body.length > MAX_RESOURCE_SIZE) {
          return log.debug('- Skipping resource larger than 15MB', meta);
        } else if (!ALLOWED_STATUSES.includes(response.status)) {
          return log.debug(`- Skipping disallowed status [${response.status}]`, meta);
        } else if (!enableJavaScript && !ALLOWED_RESOURCES.includes(request.type)) {
          return log.debug(`- Skipping disallowed resource type [${request.type}]`, meta);
        }

        // Ensure we're getting a proper mimetype if the server or
        // asset discovery browser is sending `text/plain`
        let resourceMimeType = response.mimeType === 'text/plain' ? mime.lookup(response.url) : response.mimeType;

        if (resourceMimeType?.includes('font')) {
          // Request & save font files directly as binaries rather than relying on
          // the asset discovery browser to decode font responses properly.
          // Without this, some fonts may be captured as corrupted
          body = await makeRequest(response.url, { buffer: true });
        }

        resource = createResource(url, body, resourceMimeType, {
          status: response.status,
          // 'Network.responseReceived' returns headers split by newlines, however
          // `Fetch.fulfillRequest` (used for cached responses) will hang with newlines.
          headers: Object.entries(response.headers)
            .reduce((norm, [key, value]) => (
              Object.assign(norm, { [key]: value.split('\n') })
            ), {})
        });

        log.debug(`- sha: ${resource.sha}`, meta);
        log.debug(`- mimetype: ${resourceMimeType}`, meta);
      }

      saveResource(resource);
    } catch (error) {
      log.debug(`Encountered an error processing resource: ${url}`, meta);
      log.debug(error);
    }
  };
}

export function createRequestFailedHandler(network) {
  let log = logger('core:discovery');

  return ({ url, error }) => {
    // do not log generic failures since the real error was most likely
    // already logged from elsewhere
    if (error !== 'net::ERR_FAILED') {
      log.debug(`Request failed for ${url}: ${error}`, { ...network.meta, url });
    }
  };
}
