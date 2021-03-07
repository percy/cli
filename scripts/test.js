const cwd = process.cwd();
const path = require('path');
const colors = require('colors/safe');

process.env.NODE_ENV = 'test';

// borrow yargs-parser to process command arguments
const argv = require('yargs-parser')(process.argv.slice(2), {
  alias: { node: 'n', browsers: 'b', coverage: 'c', reporter: 'r', watch: 'w' },
  boolean: ['node', 'browsers', 'coverage', 'watch'],
  array: ['karma.browsers', 'karma.reporters'],
  string: ['reporter']
});

// promisified child_process util
function child(type, cmd, args, options) {
  options = { stdio: 'inherit', ...options };
  args = args.filter(Boolean);

  return new Promise((resolve, reject) => {
    require('child_process')[type](cmd, args, options)
      .on('exit', exitCode => exitCode
        ? reject(Object.assign(new Error(`EEXIT ${exitCode}`), { exitCode }))
        : resolve())
      .on('error', reject);
  });
}

// util to turn a flags object into an array of flag strings and possible values
function flagify(flags) {
  return Object.entries(flags).reduce((a, [k, v]) => (
    a.concat([v && `--${k}`, typeof v !== 'boolean' && v])
  ), []);
}

// main program
async function main({
  node,
  browsers,
  coverage,
  reporter,
  karma: karmaArgs
} = argv) {
  // determine arg defaults based on package.json values
  let pkg = require(path.join(cwd, 'package.json'));
  let testNode = node != null ? node : (!browsers && pkg.main !== pkg.browser);
  let testBrowsers = browsers != null ? browsers : (!node && pkg.browser);

  if (coverage) {
    // $ rimraf <cwd>/{.nyc_output,coverage} || true &&
    //   nyc --silent --no-clean node <root>/test.js ... &&
    //   nyc report --reporter <reporter>
    let flags = flagify({ node, browsers });
    let nycbin = require.resolve('nyc/bin/nyc');
    let rimraf = require('rimraf');

    await new Promise(r => rimraf(path.join(cwd, '{.nyc_output,coverage}'), r));
    await child('spawn', nycbin, ['--silent', '--no-clean', 'node', __filename, ...flags]);
    await child('spawn', nycbin, ['report', '--check-coverage', ...flagify({ reporter })]);
  } else if (testNode && testBrowsers) {
    // test runners assume they have control over the entire process, so give them each their own
    // forked process when both are requested to avoid processes clashing
    let flags = flagify({ coverage });

    await child('fork', __filename, ['--node', ...flags]);
    process.stdout.write('\n');

    await child('fork', __filename, ['--browsers', ...flags]);
    process.stdout.write('\n');
  } else if (testNode) {
    // $ jasmine <cwd>/test/**/*.test.js --config <config>
    let Jasmine = require('jasmine');
    let { SpecReporter } = require('jasmine-spec-reporter');
    let jasmine = new Jasmine();

    jasmine.loadConfig({
      spec_dir: 'test',
      spec_files: ['**/*.test.js'],
      requires: [require.resolve('./babel-register')],
      helpers: [require.resolve('./test-helpers')],
      random: false
    });

    jasmine.clearReporters();
    jasmine.addReporter(new SpecReporter({
      summary: {
        displayStacktrace: 'pretty'
      }
    }));

    console.log(colors.magenta('Running node tests...\n'));
    await jasmine.execute();
  } else if (testBrowsers) {
    // $ karma start --config <root>/karma.config.js
    let { Server: KarmaServer, config: { parseConfig } } = require('karma');

    let configFile = require.resolve('../karma.config');
    let config = parseConfig(configFile, karmaArgs, { throwErrors: true });
    let karma = new KarmaServer(config);

    // collect coverage for nyc here rather than use a karma plugin
    let cov = require('istanbul-lib-coverage').createCoverageMap();
    karma.on('browser_complete', (b, r) => r && cov.merge(r.coverage));
    karma.on('run_complete', () => (global.__coverage__ = cov.toJSON()));

    console.log(colors.magenta('Running browser tests...'));
    await karma.start();
  }
}

// handle errors
function handleError(err) {
  if (!err.exitCode) console.error(err);
  process.exit(err.exitCode || 1);
}

// run everything and maybe watch for changes
main().then(() => argv.watch && (
  require('./watch')(() => main().catch(handleError))
)).catch(handleError);
