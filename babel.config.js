module.exports = {
  presets: [
    ['@babel/env', {
      targets: {
        node: '12'
      }
    }]
  ],
  plugins: [
    '@babel/proposal-class-properties'
  ],
  env: {
    test: {
      plugins: [
        ['istanbul', {
          exclude: ['dist', 'test']
        }]
      ]
    }
  }
};
