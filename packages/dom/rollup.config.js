import babel from '@rollup/plugin-babel';
import resolve from '@rollup/plugin-node-resolve';
import pkg from './package.json';

export default {
  input: 'src/index.js',
  output: {
    format: 'umd',
    exports: 'named',
    name: 'PercyDOM',
    file: pkg.main
  },
  plugins: [
    resolve(),
    babel({ babelHelpers: 'bundled' })
  ],
  onwarn: message => {
    if (/circular dependency/i.test(message)) return;
    console.warn(message);
  }
};
