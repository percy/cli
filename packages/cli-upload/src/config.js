export const schema = {
  upload: {
    type: 'object',
    additionalProperties: false,
    properties: {
      files: {
        anyOf: [
          { type: 'string' },
          { type: 'array', items: { type: 'string' } }
        ],
        default: '**/*.{png,jpg,jpeg}'
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
    // image-snapshots and options were renamed
    map('imageSnapshots.files', 'upload.files');
    map('imageSnapshots.ignore', 'upload.ignore');
    del('imageSnapshots');
  }
}
