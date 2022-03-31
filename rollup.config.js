import fs from 'fs';
import path from 'path';
import alias from '@rollup/plugin-alias';
import { babel } from '@rollup/plugin-babel';
import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import { LOADER_ALIAS } from './scripts/loader.js';

const cwd = process.cwd();
const pkg = JSON.parse(fs.readFileSync(path.join(cwd, 'package.json')));
const config = path => path.split('.').reduce((v, k) => v && v[k], pkg.rollup);

// constants and functions used for external bundles
const BUILTINS_REG = /^(?:stream|http)(\/.+)?$/;
const ENTRY_REG = localFileRegExp('src(/index.js)?');
const TEST_HELPERS_REG = localFileRegExp('test/helpers(.js)?');
const BUNDLE_NAME = config('output.name');
const TEST_BUNDLE_NAME = `${BUNDLE_NAME}.TestHelpers`;

function localFileRegExp(path) {
  let escaped = (`${cwd}/(${path})$`).replace(/[/\\]/g, '[/\\\\]');
  return new RegExp(escaped);
}

function definedExternal(cfg, id, ret) {
  if (!cfg || !cfg.external) return;
  let g = cfg.output && cfg.output.globals;
  let ext = cfg.external.find(e => e === id || localFileRegExp(e).test(id));
  return ret ? ((g && ext && g[ext]) || 'null') : !!ext;
}

function isLocalLib(id) {
  return id === pkg.name || ENTRY_REG.test(id);
}

// ignore these warnings
const IGNORE_WARNINGS = [
  'CIRCULAR_DEPENDENCY',
  'MISSING_NODE_BUILTINS'
];

// easier to reference plugins in configs when defined in one place
const plugins = {
  alias: alias({
    entries: [{
      find: LOADER_ALIAS.find,
      replacement: LOADER_ALIAS.replace
    }]
  }),
  babel: babel({
    rootMode: 'upward',
    babelHelpers: 'bundled',
    presets: [
      ['@babel/env', {
        targets: {
          node: '14',
          browsers: [
            'last 2 versions and supports async-functions'
          ]
        }
      }]
    ]
  }),
  commonjs: commonjs({
    transformMixedEsModules: true
  }),
  resolve: resolve({
    browser: true
  }),
  customWrapper: {
    name: 'custom-wrapper',
    generateBundle(options, bundle) {
      let indent = s => s.replace(/^.+/gm, '  $&');

      if (options.format === 'iife') {
        for (let file in bundle) {
          bundle[file].code = [
            // explicitly execute the iife with a window context
            `(function() {\n${indent(bundle[file].code)}}).call(window);\n`,
            // support amd & commonjs modules by referencing the global
            'if (typeof define === "function" && define.amd) {',
            `  define([], () => window.${options.name});`,
            '} else if (typeof module === "object" && module.exports) {',
            `  module.exports = window.${options.name};`,
            '}\n'
          ].join('\n');
        }
      }
    }
  },
  transformTestHelpers: {
    name: 'transform-test-helpers',
    transform(code, id) {
      if (this.getModuleInfo(id).isEntry && config('test.output.exports') !== 'named') {
        code = code.replace(/^export {.*};?$/gms, '');
        code = code.replace(/^export ((?!default))/gm, '$1');
      }

      return { code, map: null };
    }
  }
};

// default config used for production bundles
const base = {
  input: 'src/index.js',
  external: id => (
    BUILTINS_REG.test(id) ||
    !!definedExternal(pkg.rollup, id)
  ),
  output: {
    format: 'iife',
    exports: 'named',
    extend: true,
    file: pkg.browser,
    ...pkg.rollup.output,
    globals: id => {
      if (BUILTINS_REG.test(id)) return 'null';
      return definedExternal(pkg.rollup, id, true);
    },
    intro: [
      // provide the bundle with a fake process.env if needed
      'const process = (typeof globalThis !== "undefined" && globalThis.process) || {};',
      'process.env = process.env || {};',
      // signals that the package is running in a browserified bundle
      'process.env.__PERCY_BROWSERIFIED__ = true;'
    ].join('\n')
  },
  plugins: [
    plugins.alias,
    plugins.babel,
    plugins.resolve,
    plugins.commonjs,
    plugins.customWrapper
  ],
  onwarn: warning => {
    if (IGNORE_WARNINGS.includes(warning.code)) return;
    console.warn(warning);
  }
};

// test config used for test bundles
export const test = {
  ...base,
  output: {
    ...base.output,
    file: null,
    sourcemap: 'inline',
    intro: [
      base.output.intro, '',
      // persist the fake process.env for testing
      'globalThis.process = globalThis.process || process;'
    ].join('\n')
  }
};

// test config used to bundle test helpers
export const testHelpers = {
  ...test,
  external: (id, parent) => (
    isLocalLib(id) ||
    BUILTINS_REG.test(id) ||
    (parent && TEST_HELPERS_REG.test(id)) ||
    !!definedExternal(pkg.rollup.test, id)
  ),
  output: {
    ...test.output,
    name: TEST_BUNDLE_NAME,
    exports: config('test.output.exports') || 'default',
    globals: id => {
      if (isLocalLib(id)) return BUNDLE_NAME;
      if (TEST_HELPERS_REG.test(id)) return TEST_BUNDLE_NAME;
      if (BUILTINS_REG.test(id)) return 'null';
      return definedExternal(pkg.rollup.test, id, true);
    }
  },
  plugins: [
    plugins.alias,
    plugins.resolve,
    plugins.commonjs,
    plugins.babel,
    plugins.customWrapper,
    plugins.transformTestHelpers
  ]
};

// test config used to bundle test files
export const testFiles = {
  ...testHelpers,
  output: {
    ...testHelpers.output,
    name: `${BUNDLE_NAME}.Tests`,
    exports: 'none'
  }
};

// export default bundle config
const bundles = [base];

// bundle test helpers if necessary
if (pkg.files.includes('test/client.js')) {
  bundles.push({
    ...testHelpers,
    input: 'test/helpers.js',
    output: {
      ...testHelpers.output,
      file: 'test/client.js',
      sourcemap: false
    }
  });
}

export default bundles;
