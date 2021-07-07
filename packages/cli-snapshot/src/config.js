// Config schema for static directories
export const schema = {
  static: {
    type: 'object',
    additionalProperties: false,
    properties: {
      baseUrl: {
        type: 'string',
        pattern: '^/',
        default: '/',
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
        { type: '/snapshot#/properties/url' }
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
