import command from '@percy/cli-command';
import * as ExecPlugin from '@percy/cli-exec';
import { maybeInjectMaestroServer, maybeInjectScreenshotDir } from './maestro-inject.js';

export const ping = ExecPlugin.ping;
export const stop = ExecPlugin.stop;

export const start = command('start', {
  description: 'Starts a locally running Percy process for native apps',
  examples: ['$0 &> percy.log'],

  percy: {
    server: true,
    projectType: 'app',
    skipDiscovery: true
  }
}, ExecPlugin.start.callback);

export const exec = command('exec', {
  description: 'Start and stop Percy around a supplied command for native apps',
  usage: '[options] -- <command>',
  commands: [start, stop, ping],

  flags: ExecPlugin.default.definition
  // grouped flags are built-in flags
    .flags.filter(f => !f.group),

  percy: {
    server: true,
    projectType: 'app',
    skipDiscovery: true
  }
}, async function*(ctx) {
  // The two helpers splice their flag groups at argv index 2 (between `test`
  // and the flow file) because `-e` and `--test-output-dir` are
  // `test`-subcommand options. Resulting argv for `maestro test flow.yaml`:
  //   maestro test --test-output-dir <dir> -e PERCY_SERVER=<url> flow.yaml
  // iOS driver port: not prescribed from this side — the @percy/core relay
  // reads `PERCY_IOS_DRIVER_HOST_PORT` (BS-host-injected on production
  // hosts) and probes the documented Maestro 2.4.0 single-simulator default
  // (`127.0.0.1:7001`) when it isn't set. See `packages/core/src/maestro-hierarchy.js`.
  maybeInjectMaestroServer(ctx, ctx.log);
  maybeInjectScreenshotDir(ctx, ctx.log);
  yield* ExecPlugin.default.callback(ctx);
});

export default exec;
