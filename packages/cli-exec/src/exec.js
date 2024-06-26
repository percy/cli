import command from '@percy/cli-command';
import logger from '@percy/logger';
import start from './start.js';
import stop from './stop.js';
import ping from './ping.js';
import { waitForTimeout } from '@percy/client/utils';

export const exec = command('exec', {
  description: 'Start and stop Percy around a supplied command',
  usage: '[options] -- <command>',
  commands: [start, stop, ping],

  flags: [{
    name: 'parallel',
    description: 'Marks the build as one of many parallel builds',
    parse: () => !!(process.env.PERCY_PARALLEL_TOTAL ||= '-1')
  }, {
    name: 'partial',
    description: 'Marks the build as a partial build',
    parse: () => !!(process.env.PERCY_PARTIAL_BUILD ||= '1')
  }, {
    name: 'testing',
    percyrc: 'testing',
    hidden: true
  }],

  examples: [
    '$0 -- echo "percy is running around this echo command"',
    '$0 -- yarn test'
  ],

  loose: [
    'Warning: Missing command separator (--),',
    'some command options may not work as expected'
  ].join(' '),

  percy: {
    server: true,
    projectType: 'web'
  }
}, async function*({ flags, argv, env, percy, log, exit }) {
  let [command, ...args] = argv;

  // command is required
  if (!command) {
    log.error("You must supply a command to run after '--'");
    log.info('Example:');
    log.info('  $ percy exec -- npm test');
    exit(1, '', false);
  }

  // verify the provided command exists
  let { default: which } = await import('which');

  if (!which.sync(command, { nothrow: true })) {
    exit(127, `Command not found "${command}"`, false);
  }

  // attempt to start percy if enabled
  if (!percy) {
    log.warn('Percy is disabled');
  } else {
    try {
      // Skip this for app because they are triggered as app:exec
      // Remove this once they move to exec command as well
      if (percy.projectType !== 'app') {
        percy.projectType = percy.client.tokenType();
        percy.skipDiscovery = percy.shouldSkipAssetDiscovery(percy.projectType);
      } else {
        log.debug('Skipping percy project attribute calculation');
      }
      yield* percy.yield.start();
    } catch (error) {
      if (error.name === 'AbortError') throw error;
      log.warn('Skipping visual tests');
      log.error(error);
    }
  }

  // provide SDKs with useful env vars
  env.PERCY_SERVER_ADDRESS = percy?.address();
  env.PERCY_BUILD_ID = percy?.build?.id;
  env.PERCY_BUILD_URL = percy?.build?.url;
  env.PERCY_LOGLEVEL = log.loglevel();

  // run the provided command
  log.info(`Running "${[command, ...args].join(' ')}"`);
  let [status, error] = yield* spawn(command, args, percy);

  // stop percy if running (force stop if there is an error);
  await percy?.stop(!!error);

  log.info(`Command "${[command, ...args].join(' ')}" exited with status: ${status}`);
  // forward any returned status code
  if (status) exit(status, error, false);

  // force exit post timeout
  await waitForTimeout(10000);
  process.exit(status);
});

// Spawn a command with cross-spawn and return an array containing the resulting status code along
// with any error encountered while running. Uses a generator pattern to handle interupt signals.
async function* spawn(cmd, args, percy) {
  let { default: crossSpawn } = await import('cross-spawn');
  let proc, closed, error;
  const cilog = logger('ci');

  try {
    proc = crossSpawn(cmd, args, { stdio: 'pipe' });
    // Writing stdout of proc to process
    if (proc.stdout) {
      proc.stdout.on('data', (data) => {
        process.stdout.write(`${data}`);
      });
    }
    // Piping proc sdtin to process
    process.stdin.pipe(proc.stdin);

    if (proc.stderr) {
      proc.stderr.on('data', (data) => {
        const message = data.toString();
        let entry = { message, timestamp: Date.now(), type: 'ci' };
        // only collect logs if percy was enabled
        if (percy) cilog.error(entry);
        process.stderr.write(`${data}`);
      });
    }

    proc.on('error', err => (error = err));

    proc.on('close', code => {
      closed = code;
    });

    // run until an event is triggered
    /* eslint-disable-next-line no-unmodified-loop-condition */
    while (closed == null && error == null) {
      yield new Promise(r => setImmediate(r));
    }

    if (error) throw error;
    return [closed];
  } catch (err) {
    if (!err.signal) return [1, err];
    proc.kill(err.signal);
    return [0, err];
  }
}

export default exec;
