import command from '@percy/cli-command';
import * as common from './common';

import start from './start';
import stop from './stop';
import ping from './ping';

export const exec = command('exec', {
  description: 'Start and stop Percy around a supplied command',
  usage: '[options] -- <command>',
  commands: [start, stop, ping],

  flags: [...common.flags, {
    name: 'parallel',
    description: 'Marks the build as one of many parallel builds',
    parse: () => !!(process.env.PERCY_PARALLEL_TOTAL ||= '-1')
  }, {
    name: 'partial',
    description: 'Marks the build as a partial build',
    parse: () => !!(process.env.PERCY_PARTIAL_BUILD ||= '1')
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
    server: true
  }
}, async function*({ flags, argv, env, percy, log, exit }) {
  let [command, ...args] = argv;

  // command is required
  if (!command) {
    log.error("You must supply a command to run after '--'");
    log.info('Example:');
    log.info('  $ percy exec -- npm test');
    exit(1);
  }

  // verify the provided command exists
  let which = await import('which');

  if (!which.sync(command, { nothrow: true })) {
    exit(127, `Command not found "${command}"`);
  }

  // attempt to start percy if enabled
  if (!percy) {
    log.warn('Percy is disabled');
  } else {
    try {
      yield* percy.start();
    } catch (error) {
      if (error.canceled) throw error;
      log.warn('Skipping visual tests');
      log.error(error);
    }
  }

  // provide SDKs with useful env vars
  env.PERCY_SERVER_ADDRESS ||= percy?.address();
  env.PERCY_LOGLEVEL ||= log.loglevel();

  // run the provided command
  log.info(`Running "${[command, ...args].join(' ')}"`);
  let [status, error] = yield* spawn(command, args);

  // stop percy if running (force stop if there is an error);
  await percy?.stop(!!error);

  // forward any returned status code
  if (status) exit(status, error);
});

// Spawn a command with cross-spawn and return an array containing the resulting status code along
// with any error encountered while running. Uses a generator pattern to handle interupt signals.
async function* spawn(cmd, args) {
  let { default: crossSpawn } = await import('cross-spawn');
  let proc, closed, error;

  try {
    proc = crossSpawn(cmd, args, { stdio: 'inherit' });
    proc.on('close', code => (closed = code));
    proc.on('error', err => (error = err));

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
