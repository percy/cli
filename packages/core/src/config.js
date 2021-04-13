// Common options used in Percy commands
export const schema = {
  snapshot: {
    type: 'object',
    additionalProperties: false,
    properties: {
      widths: {
        type: 'array',
        items: { type: 'integer' },
        default: [375, 1280]
      },
      minHeight: {
        type: 'integer',
        default: 1024
      },
      percyCSS: {
        type: 'string',
        default: ''
      },
      enableJavaScript: {
        type: 'boolean'
      }
    }
  },
  discovery: {
    type: 'object',
    additionalProperties: false,
    properties: {
      allowedHostnames: {
        type: 'array',
        items: { type: 'string' },
        default: []
      },
      networkIdleTimeout: {
        type: 'integer',
        default: 100
      },
      disableCache: {
        type: 'boolean',
        default: false
      },
      requestHeaders: {
        type: 'object',
        additionalProperties: { type: 'string' }
      },
      authorization: {
        type: 'object',
        additionalProperties: false,
        properties: {
          username: { type: 'string' },
          password: { type: 'string' }
        }
      },
      concurrency: {
        type: 'integer'
      },
      launchOptions: {
        type: 'object',
        additionalProperties: false,
        properties: {
          executable: { type: 'string' },
          timeout: { type: 'integer' },
          args: { type: 'array', items: { type: 'string' } },
          headless: { type: 'boolean' }
        }
      }
    }
  }
};

// Migration function
export function migration(config, { map, del, log }) {
  /* eslint-disable curly */
  if (config.version < 2) {
    // discovery options have moved
    map('agent.assetDiscovery.allowedHostnames', 'discovery.allowedHostnames');
    map('agent.assetDiscovery.networkIdleTimeout', 'discovery.networkIdleTimeout');
    map('agent.assetDiscovery.cacheResponses', 'discovery.disableCache', v => !v);
    map('agent.assetDiscovery.requestHeaders', 'discovery.requestHeaders');
    map('agent.assetDiscovery.pagePoolSizeMax', 'discovery.concurrency');
    del('agent');
  } else {
    // snapshot discovery options have moved
    for (let k of ['authorization', 'requestHeaders']) {
      if (config.snapshot?.[k]) {
        log.deprecated(
          `The config option \`snapshot.${k}\` will be removed in 1.0.0. ` +
          `Use \`discovery.${k}\` instead.`);
        map(`snapshot.${k}`, `discovery.${k}`);
      }
    }
  }
}
