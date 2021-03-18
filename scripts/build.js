const cwd = process.cwd();
const path = require('path');
const colors = require('colors');

process.env.NODE_ENV = 'production';

// borrow yargs-parser to process command arguments
const argv = require('yargs-parser')(process.argv.slice(2), {
  alias: { node: 'n', bundle: 'b', watch: 'w' },
  boolean: ['node', 'bundle', 'watch']
});

// main program
async function main({ node, bundle } = argv) {
  // determine default options based on package.json values
  let pkg = require(path.join(cwd, 'package.json'));
  let buildNode = node != null ? node : (!bundle && pkg.main !== pkg.browser);
  let buildBundle = bundle != null ? node : (!node && pkg.browser);

  if (buildNode) {
    console.log(colors.magenta('Building node modules...'));

    // $ babel <cwd>/src --out-dir <cwd>/dist --root-mode upward
    await require('@babel/cli/lib/babel/dir').default({
      cliOptions: { filenames: ['src'], outDir: 'dist' },
      babelOptions: { rootMode: 'upward' }
    });
  }

  if (buildBundle) {
    if (buildNode) process.stdout.write('\n');
    console.log(colors.magenta('Building browser bundle...'));
    let start = Date.now();

    // $ rollup --config <root>/rollup.config.js
    for (let config of require('../rollup.config').default) {
      let bundle = await require('rollup').rollup(config);
      await bundle.write(config.output);
      await bundle.close();

      // programatic rollup api doesn't log
      console.log(`${
        colors.green(`${config.input} → ${config.output.file}`)
      } (${Date.now() - start}ms)`);
    }
  }
}

// handle errors
function handleError(err) {
  if (!err.exitCode) console.error(err);
  if (!argv.watch) process.exit(err.exitCode || 1);
}

// run everything and maybe watch for changes
main().catch(handleError).then(() => argv.watch && (
  require('./watch')(() => main().catch(handleError))
));
