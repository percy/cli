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
