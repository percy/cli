/* eslint-disable import/no-extraneous-dependencies */
import fs from 'fs';
import url from 'url';
import path from 'path';
import cp from 'child_process';
import parse from 'yargs-parser';
import colors from 'colors/safe.js';

const cwd = process.cwd();
const filename = url.fileURLToPath(import.meta.url);

process.env.NODE_ENV = 'test';

// borrow yargs-parser to process command arguments
const argv = parse(process.argv.slice(2), {
  configuration: { 'strip-aliased': true },
  alias: { node: 'n', browsers: 'b', coverage: 'c', reporter: 'r', watch: 'w' },
  boolean: ['node', 'browsers', 'coverage', 'watch'],
  array: ['karma.browsers', 'karma.reporters'],
  string: ['reporter']
});

// promisified child_process util
function child(type, cmd, args, options) {
  if (type === 'exec') {
    // convert exec args to spawn args for better stdio handling
    [type, cmd, args, options] = cmd.split(' ').reduce((args, word) => (
      args[1] ? args[2].push(word) : (args[1] = word)
    ) && args, ['spawn', '', [], args]);
  }

  options = { stdio: 'inherit', ...options };
  args = args.filter(Boolean);

  return new Promise((resolve, reject) => {
    cp[type](cmd, args, options)
      .on('exit', exitCode => exitCode
        ? reject(Object.assign(new Error(`EEXIT ${exitCode}`), { exitCode }))
        : resolve())
      .on('error', reject);
  });
}

// util to turn a flags object into an array of flag strings and possible values
function flagify(flags, prefix = '', args = []) {
  return Object.entries(flags).reduce((args, [key, val]) => {
    let push = (f, ...v) => args.includes(f) ? args : args.push(f, ...v);
    key = key.replace(/([a-z])([A-Z])/g, (_, l, u) => `${l}-${u.toLowerCase()}`);

    for (let v of [].concat(val)) {
      if (typeof v === 'object') {
        flagify(v, `${prefix}${key}.`, args);
      } else if (typeof v === 'boolean') {
        push(`--${v ? '' : 'no-'}${prefix}${key}`);
      } else if (v) {
        push(`--${prefix}${key}`, v);
      }
    }

    return args;
  }, args);
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
  let pkg = JSON.parse(fs.readFileSync(path.join(cwd, 'package.json')));
  let testNode = node != null ? node : (!browsers && pkg.main !== pkg.browser);
  let testBrowsers = browsers != null ? browsers : (!node && pkg.browser);

  if (coverage) {
    // $ rimraf <cwd>/{.nyc_output,coverage} || true &&
    //   nyc --silent --no-clean node <root>/test.js ... &&
    //   nyc report --reporter <reporter>
    let flags = flagify({ node, browsers });
    let nycbin = path.resolve(filename, '../../node_modules/.bin/nyc');
    let { default: rimraf } = await import('rimraf');

    await new Promise(r => rimraf(path.join(cwd, '{.nyc_output,coverage}'), r));
    await child('spawn', nycbin, ['--silent', '--no-clean', 'node', filename, ...flags]);
    await child('spawn', nycbin, ['report', '--check-coverage', ...flagify({ reporter })]);
  } else if (!process.send) {
    // test runners assume they have control over the entire process, so give them each forks
    let flags = flagify({ coverage, karma: karmaArgs });
    let loader = url.pathToFileURL(path.resolve(filename, '../loader.js')).href;
    let opts = { execArgv: ['--loader', loader, ...process.execArgv] };

    if (testNode) {
      await child('fork', filename, ['--node', ...flags], opts);
      process.stdout.write('\n');
    }

    if (testBrowsers) {
      await child('fork', filename, ['--browsers', ...flags], opts);
      process.stdout.write('\n');
    }
  } else if (testNode) {
    // $ jasmine <cwd>/test/**/*.test.js --config <config>
    let { default: Jasmine } = await import('jasmine');
    // let { SpecReporter } = await import('jasmine-spec-reporter');
    let jasmine = new Jasmine();

    jasmine.loadConfig({
      spec_dir: 'test',
      spec_files: ['**/*.test.js'],
      requires: [path.resolve(filename, '../babel-register.cjs')],
      helpers: [path.resolve(filename, '../test-helpers.js')],
      random: false
    });

    // jasmine.clearReporters();
    // jasmine.addReporter(new SpecReporter({
    //   spec: {
    //     displayPending: true
    //   },
    //   summary: {
    //     displayPending: false,
    //     displayStacktrace: 'pretty'
    //   }
    // }));

    console.log(colors.magenta('Running node tests...\n'));
    await jasmine.execute();
  } else if (testBrowsers) {
    // $ karma start --config <root>/karma.config.js
    let { default: Karma } = await import('karma');
    let { Server: KarmaServer, config: { parseConfig } } = Karma;

    let configFile = path.resolve(filename, '../../karma.config.cjs');
    let karma = new KarmaServer(await parseConfig(configFile, karmaArgs, {
      promiseConfig: true,
      throwErrors: true
    }));

    // attach any karma hooks
    if (pkg.karma) {
      for (let [event, exec] of Object.entries(pkg.karma)) {
        karma.on(event, () => child('exec', exec));
      }
    }

    // collect coverage for nyc here rather than use a karma plugin
    let { default: istcov } = await import('istanbul-lib-coverage');
    let cov = istcov.createCoverageMap();

    karma.on('browser_complete', (b, r) => r && cov.merge(r.coverage));
    karma.on('run_complete', () => (global.__coverage__ = cov.toJSON()));

    console.log(colors.magenta('Running browser tests...'));
    await karma.start();
  }
}

// handle errors
function handleError(err) {
  if (!err.exitCode) console.error(err);
  if (!argv.watch) process.exit(err.exitCode || 1);
}

// run everything and maybe watch for changes
main().catch(handleError).then(() => argv.watch && (
  import('./watch').then(w => w.watch(() => main().catch(handleError)))
));
