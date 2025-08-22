/* eslint-disable import/no-extraneous-dependencies */
import fs from 'fs';
import path from 'path';
import colors from 'colors/safe.js';
import parse from 'yargs-parser';

const cwd = process.cwd();
process.env.NODE_ENV = 'production';

// borrow yargs-parser to process command arguments
const argv = parse(process.argv.slice(2), {
  alias: { node: 'n', bundle: 'b', watch: 'w' },
  boolean: ['node', 'bundle', 'watch']
});

// main program
async function main({ node, bundle } = argv) {
  // determine default options based on package.json values
  let pkg = JSON.parse(fs.readFileSync(path.join(cwd, 'package.json')));
  let buildNode = node != null ? node : (!bundle && pkg.main !== pkg.browser);
  let buildBundle = bundle != null ? node : (!node && pkg.browser);

  if (buildNode) {
    console.log(colors.magenta('Building node modules...'));
    let { default: babel } = await import('@babel/cli/lib/babel/dir.js');
    let cliOptions = { filenames: ['src'], outDir: 'dist', copyFiles: true };
    let babelOptions = { rootMode: 'upward' };

    // $ babel <cwd>/src --out-dir <cwd>/dist --root-mode upward
    await babel.default({ cliOptions, babelOptions });
  }

  if (buildBundle) {
    if (buildNode) process.stdout.write('\n');
    console.log(colors.magenta('Building browser bundle...'));
    let rollupConfig = await import('../rollup.config.js');
    let { rollup } = await import('rollup');
    let start = Date.now();

    // $ rollup --config <root>/rollup.config.js
    for (let config of rollupConfig.default) {
      let bundle = await rollup(config);
      await bundle.write(config.output);
      await bundle.close();

      // programmatic rollup api doesn't log
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
  import('./watch.js').then(w => w.watch(() => main().catch(handleError)))
));
