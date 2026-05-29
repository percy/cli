import path from 'path';
import command from '@percy/cli-command';
import * as ExecPlugin from '@percy/cli-exec';

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

function hasExistingPercyServerFlag(args) {
  for (let i = 2; i < args.length - 1; i++) {
    if (args[i] === '-e' && /^PERCY_SERVER=/.test(args[i + 1])) return true;
  }
  return false;
}

// Maestro's GraalJS sandbox does NOT inherit the parent process's env,
// so `PERCY_SERVER_ADDRESS` exported by app:exec is invisible to the
// SDK. When wrapping `maestro test`, surface the CLI address through
// Maestro's only env channel — `-e KEY=VALUE` flags — so the SDK
// healthcheck can find the local CLI without the customer having to
// pair ports manually. No-op when the customer already supplied their
// own `-e PERCY_SERVER=...`.
export function maybeInjectMaestroServer(ctx) {
  const args = ctx?.argv;
  if (!Array.isArray(args) || args.length < 2) return;
  if (path.basename(args[0]) !== 'maestro') return;
  if (args[1] !== 'test') return;
  if (hasExistingPercyServerFlag(args)) return;
  const addr = ctx.percy?.address();
  if (!addr) return;
  args.splice(2, 0, '-e', `PERCY_SERVER=${addr}`);
}

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
  maybeInjectMaestroServer(ctx);
  yield* ExecPlugin.default.callback(ctx);
});

export default exec;
