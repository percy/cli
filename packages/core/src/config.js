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
export function migration(input, set) {
  /* eslint-disable curly */
  if (input.version < 2) {
    // previous snapshot options map 1:1
    if (input.snapshot != null)
      set('snapshot', input.snapshot);
    // request-headers option moved
    if (input.agent?.assetDiscovery?.requestHeaders != null)
      set('snapshot.requestHeaders', input.agent.assetDiscovery.requestHeaders);
    // allowed-hostnames moved
    if (input.agent?.assetDiscovery?.allowedHostnames != null)
      set('discovery.allowedHostnames', input.agent.assetDiscovery.allowedHostnames);
    // network-idle-timeout moved
    if (input.agent?.assetDiscovery?.networkIdleTimeout != null)
      set('discovery.networkIdleTimeout', input.agent.assetDiscovery.networkIdleTimeout);
    // page pooling was rewritten to be a concurrent task queue
    if (input.agent?.assetDiscovery?.pagePoolSizeMax != null)
      set('discovery.concurrency', input.agent.assetDiscovery.pagePoolSizeMax);
    // cache-responses was renamed to match the CLI flag
    if (input.agent?.assetDiscovery?.cacheResponses != null)
      set('discovery.disableCache', !input.agent.assetDiscovery.cacheResponses);
  }
}
