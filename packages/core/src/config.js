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
        additionalProperties: { type: 'string' },
      },
      authorization: {
        type: 'object',
        additionalProperties: false,
        properties: {
          username: { type: 'string' },
          password: { type: 'string' },
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
        type: 'integer',
        default: 5
      },
      launchOptions: {
        type: 'object',
        additionalProperties: false,
        properties: {
          executable: { type: 'string' },
          headless: { type: 'boolean' },
          args: { type: 'array', items: { type: 'string' } },
          timeout: { type: 'integer' }
        }
      }
    }
  }
};
