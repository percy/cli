import { snapshotSchema } from '@percy/core/dist/config';

// Common schemas referenced by other schemas
export const cliSchema = {
  $id: '/snapshot/cli',
  $refs: {
    predicate: {
      oneOf: [
        { type: 'string' },
        { instanceof: 'RegExp' },
        { instanceof: 'Function' },
        { type: 'array', items: { $ref: '#/$refs/predicate' } }
      ]
    }
  }
};

// Config schema for static directories
export const configSchema = {
  static: {
    type: 'object',
    additionalProperties: false,
    properties: {
      baseUrl: {
        type: 'string',
        pattern: '^/',
        errors: {
          pattern: 'must start with a forward slash (/)'
        }
      },
      include: {
        $ref: '/snapshot/cli#/$refs/predicate'
      },
      exclude: {
        $ref: '/snapshot/cli#/$refs/predicate'
      },
      cleanUrls: {
        type: 'boolean',
        default: false
      },
      rewrites: {
        type: 'object',
        normalize: false,
        additionalProperties: { type: 'string' }
      },
      overrides: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            include: { $ref: '/snapshot/cli#/$refs/predicate' },
            exclude: { $ref: '/snapshot/cli#/$refs/predicate' },
            // schemas have no concept of inheritance, but we can leverage JS for brevity
            ...snapshotSchema.properties
          }
        }
      }
    }
  },

  sitemap: {
    type: 'object',
    additionalProperties: false,
    properties: {
      include: {
        $ref: '/snapshot/cli#/$refs/predicate'
      },
      exclude: {
        $ref: '/snapshot/cli#/$refs/predicate'
      },
      overrides: {
        $ref: '/config/static#/properties/overrides'
      }
    }
  }
};

// Page listing schema
export const snapshotListSchema = {
  $id: '/snapshot/list',
  oneOf: [{
    type: 'array',
    items: {
      oneOf: [
        { $ref: '/snapshot' },
        { type: 'string' }
      ]
    }
  }, {
    type: 'object',
    required: ['snapshots'],
    properties: {
      baseUrl: {
        type: 'string',
        pattern: '^https?://',
        errors: {
          pattern: 'must include with a protocol and hostname'
        }
      },
      include: { $ref: '/snapshot/cli#/$refs/predicate' },
      exclude: { $ref: '/snapshot/cli#/$refs/predicate' },
      snapshots: { $ref: '#/oneOf/0' }
    }
  }]
};

export const schemas = [
  cliSchema,
  configSchema,
  snapshotListSchema
];

export function migration(config, util) {
  /* eslint-disable curly */
  if (config.version < 2) {
    // static-snapshots and options were renamed
    util.map('staticSnapshots.baseUrl', 'static.baseUrl');
    util.map('staticSnapshots.snapshotFiles', 'static.include');
    util.map('staticSnapshots.ignoreFiles', 'static.exclude');
    util.del('staticSnapshots');
  } else {
    let notice = { type: 'config', until: '1.0.0' };
    // static files and ignore options were renamed
    util.deprecate('static.files', { map: 'static.include', ...notice });
    util.deprecate('static.ignore', { map: 'static.exclude', ...notice });

    for (let i in (config.static?.overrides || [])) {
      let k = `static.overrides[${i}]`;
      util.deprecate(`${k}.files`, { map: `${k}.include`, ...notice });
      util.deprecate(`${k}.ignore`, { map: `${k}.exclude`, ...notice });
    }
  }
}
