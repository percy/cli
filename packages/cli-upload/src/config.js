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

export function migration(input, set) {
  /* eslint-disable curly */
  if (input.version < 2) {
    // image-snapshots and options were renamed
    if (input.imageSnapshots?.files != null)
      set('upload.files', input.imageSnapshots.files);
    if (input.imageSnapshots?.ignore != null)
      set('upload.ignore', input.imageSnapshots.ignore);
  }
}
