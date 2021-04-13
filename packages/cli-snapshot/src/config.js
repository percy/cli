export const schema = {
  static: {
    type: 'object',
    additionalProperties: false,
    properties: {
      baseUrl: {
        type: 'string',
        default: '/'
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
