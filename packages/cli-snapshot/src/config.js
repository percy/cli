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
