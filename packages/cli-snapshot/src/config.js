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

export function migration(input, set) {
  /* eslint-disable curly */
  if (input.version < 2) {
    // static-snapshots and options were renamed
    if (input.staticSnapshots?.baseUrl != null)
      set('static.baseUrl', input.staticSnapshots.baseUrl);
    if (input.staticSnapshots?.snapshotFiles != null)
      set('static.files', input.staticSnapshots.snapshotFiles);
    if (input.staticSnapshots?.ignoreFiles != null)
      set('static.ignore', input.staticSnapshots.ignoreFiles);
  }
}
