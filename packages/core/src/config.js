// Common config options used in Percy commands
export const configSchema = {
  snapshot: {
    type: 'object',
    additionalProperties: false,
    properties: {
      widths: {
        type: 'array',
        default: [375, 1280],
        items: {
          type: 'integer',
          maximum: 2000,
          minimum: 10
        }
      },
      minHeight: {
        type: 'integer',
        default: 1024,
        maximum: 2000,
        minimum: 10
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
        default: [],
        items: {
          type: 'string',
          allOf: [{
            not: { pattern: '[^/]/' },
            error: 'must not include a pathname'
          }, {
            not: { pattern: '^([a-zA-Z]+:)?//' },
            error: 'must not include a protocol'
          }]
        }
      },
      networkIdleTimeout: {
        type: 'integer',
        default: 100,
        maximum: 750,
        minimum: 1
      },
      disableCache: {
        type: 'boolean'
      },
      requestHeaders: {
        type: 'object',
        normalize: false,
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
      cookies: {
        anyOf: [{
          type: 'object',
          normalize: false,
          additionalProperties: { type: 'string' }
        }, {
          type: 'array',
          normalize: false,
          items: {
            type: 'object',
            required: ['name', 'value'],
            properties: {
              name: { type: 'string' },
              value: { type: 'string' }
            }
          }
        }]
      },
      userAgent: {
        type: 'string'
      },
      concurrency: {
        type: 'integer',
        minimum: 1
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

// Common per-snapshot capture options
export const snapshotSchema = {
  $id: '/snapshot',
  type: 'object',
  required: ['url'],
  additionalProperties: false,
  $refs: {
    exec: {
      oneOf: [
        { oneOf: [{ type: 'string' }, { instanceof: 'Function' }] },
        { type: 'array', items: { $ref: '#/$refs/exec/oneOf/0' } }
      ]
    }
  },
  properties: {
    url: { type: 'string' },
    name: { type: 'string' },
    widths: { $ref: '/config/snapshot#/properties/widths' },
    minHeight: { $ref: '/config/snapshot#/properties/minHeight' },
    percyCSS: { $ref: '/config/snapshot#/properties/percyCSS' },
    enableJavaScript: { $ref: '/config/snapshot#/properties/enableJavaScript' },
    discovery: {
      type: 'object',
      additionalProperties: false,
      properties: {
        allowedHostnames: { $ref: '/config/discovery#/properties/allowedHostnames' },
        requestHeaders: { $ref: '/config/discovery#/properties/requestHeaders' },
        authorization: { $ref: '/config/discovery#/properties/authorization' },
        disableCache: { $ref: '/config/discovery#/properties/disableCache' },
        userAgent: { $ref: '/config/discovery#/properties/userAgent' }
      }
    },
    waitForSelector: {
      type: 'string'
    },
    waitForTimeout: {
      type: 'integer',
      minimum: 1,
      maximum: 30000
    },
    execute: {
      oneOf: [{
        $ref: '/snapshot#/$refs/exec'
      }, {
        type: 'object',
        additionalProperties: false,
        properties: {
          afterNavigation: { $ref: '/snapshot#/$refs/exec' },
          beforeResize: { $ref: '/snapshot#/$refs/exec' },
          afterResize: { $ref: '/snapshot#/$refs/exec' },
          beforeSnapshot: { $ref: '/snapshot#/$refs/exec' }
        }
      }]
    },
    additionalSnapshots: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        oneOf: [{
          required: ['name']
        }, {
          anyOf: [
            { required: ['prefix'] },
            { required: ['suffix'] }
          ]
        }],
        properties: {
          prefix: { type: 'string' },
          suffix: { type: 'string' },
          name: { $ref: '/snapshot#/properties/name' },
          waitForTimeout: { $ref: '/snapshot#/properties/waitForTimeout' },
          waitForSelector: { $ref: '/snapshot#/properties/waitForSelector' },
          execute: { $ref: '/snapshot#/$refs/exec' }
        },
        errors: {
          oneOf: ({ params }) => (
            params.passingSchemas
              ? 'prefix & suffix are ignored when a name is provided'
              : 'missing required name, prefix, or suffix'
          )
        }
      }
    }
  }
};

// Disallow capture options for dom snapshots
export const snapshotDOMSchema = {
  $id: '/snapshot/dom',
  type: 'object',
  additionalProperties: false,
  required: [
    'url',
    'domSnapshot'
  ],
  disallowed: [
    'additionalSnapshots',
    'waitForTimeout',
    'waitForSelector',
    'execute'
  ],
  errors: {
    disallowed: 'not accepted with DOM snapshots'
  },
  properties: {
    domSnapshot: { type: 'string' },
    // schemas have no concept of inheritance, but we can leverage JS for brevity
    ...snapshotSchema.properties
  }
};

// Config migrate function
export function configMigration(config, util) {
  /* eslint-disable curly */
  if (config.version < 2) {
    // discovery options have moved
    util.map('agent.assetDiscovery.allowedHostnames', 'discovery.allowedHostnames');
    util.map('agent.assetDiscovery.networkIdleTimeout', 'discovery.networkIdleTimeout');
    util.map('agent.assetDiscovery.cacheResponses', 'discovery.disableCache', v => !v);
    util.map('agent.assetDiscovery.requestHeaders', 'discovery.requestHeaders');
    util.map('agent.assetDiscovery.pagePoolSizeMax', 'discovery.concurrency');
    util.del('agent');
  } else {
    let notice = { type: 'config', until: '1.0.0' };
    // snapshot discovery options have moved
    util.deprecate('snapshot.authorization', { map: 'discovery.authorization', ...notice });
    util.deprecate('snapshot.requestHeaders', { map: 'discovery.requestHeaders', ...notice });
  }
}

// Snapshot option migrate function
export function snapshotMigration(config, util) {
  let notice = { type: 'snapshot', until: '1.0.0', warn: true };
  // discovery options have moved
  util.deprecate('authorization', { map: 'discovery.authorization', ...notice });
  util.deprecate('requestHeaders', { map: 'discovery.requestHeaders', ...notice });
  // snapshots option was renamed
  util.deprecate('snapshots', { map: 'additionalSnapshots', ...notice });
}

// Convinient references for schema registrations
export const schemas = [
  configSchema,
  snapshotSchema,
  snapshotDOMSchema
];

export const migrations = [
  ['/config', configMigration],
  ['/snapshot', snapshotMigration]
];
