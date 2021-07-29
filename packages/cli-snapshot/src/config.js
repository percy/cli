import { snapshotSchema } from '@percy/core/dist/config';

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
      files: {
        anyOf: [
          { type: 'string' },
          { type: 'array', items: { type: 'string' } }
        ],
        default: '**/*.{html,htm}'
      },
      ignore: {
        anyOf: [
          { type: 'string' },
          { type: 'array', items: { type: 'string' } }
        ],
        default: ''
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
            files: { $ref: '#/properties/files' },
            ignore: { $ref: '#/properties/ignore' },
            // schemas have no concept of inheritance, but we can leverage JS for brevity
            ...snapshotSchema.properties
          }
        }
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
      snapshots: {
        $ref: '#/oneOf/0'
      }
    }
  }]
};

export const schemas = [
  configSchema,
  snapshotListSchema
];

export function migration(config, { map, del }) {
  /* eslint-disable curly */
  if (config.version < 2) {
    // static-snapshots and options were renamed
    map('staticSnapshots.baseUrl', 'static.baseUrl');
    map('staticSnapshots.snapshotFiles', 'static.files');
    map('staticSnapshots.ignoreFiles', 'static.ignore');
    del('staticSnapshots');
  }
}
