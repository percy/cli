module.exports = {
  stats: 'minimal',
  mode: 'production',
  output: {
    library: 'PercyDOM',
    libraryTarget: 'umd',
    filename: 'index.js'
  },
  module: {
    rules: [{
      test: /\.js$/,
      exclude: /node_modules/,
      loader: 'babel-loader'
    }]
  }
};
