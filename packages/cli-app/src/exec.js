import fs from 'fs';
import net from 'net';
import os from 'os';
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

// Returns the index of the value following `--test-output-dir`, or -1 if absent.
// We return the value-index (not just a boolean) so the screenshot-dir helper
// can align PERCY_MAESTRO_SCREENSHOT_DIR with a customer-supplied flag value.
function findTestOutputDirValueIdx(args) {
  for (let i = 2; i < args.length - 1; i++) {
    if (args[i] === '--test-output-dir') return i + 1;
  }
  return -1;
}

// Maestro's GraalJS sandbox does NOT inherit the parent process's env,
// so `PERCY_SERVER_ADDRESS` exported by app:exec is invisible to the
// SDK. When wrapping `maestro test`, surface the CLI address through
// Maestro's only env channel — `-e KEY=VALUE` flags — so the SDK
// healthcheck can find the local CLI without the customer having to
// pair ports manually. No-op when the customer already supplied their
// own `-e PERCY_SERVER=...`.
//
// When percy?.address() is falsy (percy disabled, start failed), emit a
// WARN so the customer is not surprised by a silent zero-snapshot build.
// The customer-override skip case (their own `-e PERCY_SERVER=...` is in
// argv) does NOT warn — that's intentional flow control, not a problem.
export function maybeInjectMaestroServer(ctx, log) {
  const args = ctx?.argv;
  if (!Array.isArray(args) || args.length < 2) return;
  if (path.basename(args[0]) !== 'maestro') return;
  if (args[1] !== 'test') return;
  if (hasExistingPercyServerFlag(args)) return;
  const addr = ctx.percy?.address();
  if (!addr) {
    log?.warn(
      'app:exec did not start the Percy CLI server (percy disabled or start ' +
      'failed); -e PERCY_SERVER not injected into maestro test. Snapshots will ' +
      'NOT be uploaded. Set PERCY_TOKEN and re-run, or check the percy log above.'
    );
    return;
  }
  args.splice(2, 0, '-e', `PERCY_SERVER=${addr}`);
}

// Auto-resolve the Maestro screenshot output directory so customers don't
// have to pair `export PERCY_MAESTRO_SCREENSHOT_DIR=...` with a matching
// `--test-output-dir <same>` in their maestro test command.
//
// Resolution order:
//   1. Customer set BOTH process.env.PERCY_MAESTRO_SCREENSHOT_DIR and
//      --test-output-dir in argv → trust them, do nothing.
//   2. Customer set PERCY_MAESTRO_SCREENSHOT_DIR only → use it, inject
//      `--test-output-dir <env value>` into argv.
//   3. Customer set --test-output-dir only → use that value, mirror it
//      into process.env.PERCY_MAESTRO_SCREENSHOT_DIR (so the SDK +
//      CLI relay see the same path).
//   4. Neither set → pick `${process.cwd()}/.percy-out`. On any mkdir
//      failure (read-only CWD, EACCES, EEXIST as a file), fall back to
//      `${os.tmpdir()}/percy-maestro-<pid>` with a WARN log.
//
// The env-var update and argv splice always keep both sources of truth
// (SDK reads env var; Maestro reads the flag) aligned to the same path.
export function maybeInjectScreenshotDir(ctx, log) {
  const args = ctx?.argv;
  if (!Array.isArray(args) || args.length < 2) return;
  if (path.basename(args[0]) !== 'maestro') return;
  if (args[1] !== 'test') return;

  const envSet = !!process.env.PERCY_MAESTRO_SCREENSHOT_DIR;
  const flagValueIdx = findTestOutputDirValueIdx(args);
  const flagSet = flagValueIdx > 0;

  // Fully customer-controlled — nothing to do.
  if (envSet && flagSet) return;

  let resolved;
  if (envSet) {
    resolved = process.env.PERCY_MAESTRO_SCREENSHOT_DIR;
  } else if (flagSet) {
    resolved = args[flagValueIdx];
  } else {
    const preferred = path.join(process.cwd(), '.percy-out');
    try {
      fs.mkdirSync(preferred, { recursive: true });
      resolved = preferred;
    } catch (err) {
      const fallback = path.join(os.tmpdir(), `percy-maestro-${process.pid}`);
      try {
        fs.mkdirSync(fallback, { recursive: true });
      } catch (_) {
        // tmpdir mkdir failure is exceedingly rare; fall through and let
        // downstream code surface a clearer error than this helper can.
      }
      resolved = fallback;
      log?.warn(
        `Could not create ${preferred} (${err.code || err.message}); ` +
        `falling back to ${fallback}. Set PERCY_MAESTRO_SCREENSHOT_DIR to ` +
        'pick a specific location.'
      );
    }
  }

  if (!envSet) process.env.PERCY_MAESTRO_SCREENSHOT_DIR = resolved;
  if (!flagSet) args.splice(2, 0, '--test-output-dir', resolved);
}

// True when argv contains a `--driver-host-port` flag the customer already
// supplied. Scans the full argv slice past argv[2] (where flow files live)
// because customers can pass the flag at any position.
function hasExistingDriverHostPortFlag(args) {
  for (let i = 2; i < args.length; i++) {
    if (args[i] === '--driver-host-port') return true;
  }
  return false;
}

// True when argv contains a Maestro sharding flag. Per Maestro's
// TestCommand.kt#selectPort, each shard calls selectPort() independently —
// if --driver-host-port N is set, shard 1 binds N and shards 2+ fail with
// `CliError("Requested driver host port N is not available")`. So when the
// customer is running sharded, we MUST NOT inject a single port. Sharded
// runs without our inject fall through to Maestro's ServerSocket(0) per-
// shard port assignment, which works fine (status quo).
//
// Matches `--shards N`, `-s N` (deprecated short form), `--shard-split N`,
// `--shard-all N`. Conservative: any flag form gates us out.
function hasShardingFlag(args) {
  for (let i = 2; i < args.length; i++) {
    if (args[i] === '--shards' || args[i] === '-s' ||
        args[i] === '--shard-split' || args[i] === '--shard-all') {
      return true;
    }
  }
  return false;
}

// Ask the OS for a free TCP port via Node's `net` module. Mirrors Maestro's
// own `ServerSocket(0)` strategy in TestCommand.kt#selectPort. Binds, reads
// the assigned port, closes immediately. Linux and macOS kernels do NOT
// immediately re-assign released ephemeral ports — the reservation window
// is tens of seconds, comfortably longer than the ~1s gap before Maestro's
// own bind. The TOCTOU race is theoretical, not realistic; if it ever
// fires, Maestro errors loudly with "Requested driver host port N is not
// available" which surfaces through `percy app:exec`'s stderr forwarding.
function pickFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address()?.port;
      server.close(() => {
        if (Number.isInteger(port) && port > 0) resolve(port);
        /* istanbul ignore next — defensive guard; Node's listen(0) on an
           available interface returns an integer port on every supported
           OS. This branch is only reachable if address() returns null
           between listen and close, which we have never observed. */
        else reject(new Error('pickFreePort: invalid port from net.createServer'));
      });
    });
  });
}

// Parse the candidate value for `PERCY_IOS_DRIVER_HOST_PORT` env override.
// Returns an integer in 1-65535 or null. Mirrors the validator semantics
// in @percy/core's `parseIosDriverHostPort` — both readers must agree on
// what "valid" means so customer-supplied values that the relay accepts
// are also the values we'll inject as the Maestro `--driver-host-port`.
function parseDriverHostPortEnv(raw) {
  if (raw === undefined || raw === null || raw === '') return null;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 65535) return null;
  return n;
}

// Prescribe-don't-discover for the iOS driver host port.
//
// `maestro test` accepts a hidden but fully-supported `--driver-host-port`
// flag (see Maestro source `App.kt:99` and `TestCommand.kt:538-549`). When
// passed, Maestro binds the driver to exactly that port. When absent,
// Maestro uses `ServerSocket(0)` and assigns a random ephemeral port we
// could not predict from outside the process.
//
// We auto-inject `--driver-host-port <PORT>` so the relay in @percy/core
// can hit the iOS driver deterministically via `PERCY_IOS_DRIVER_HOST_PORT`
// (which we also write). This replaces the older probe-and-lsof cascade.
//
// Resolution:
//   1. Customer set `--driver-host-port` in argv → no-op (their override).
//   2. Argv contains a sharding flag → no-op. Sharded runs need per-shard
//      ports; a single injected port would break shards 2+ at startup.
//   3. Customer set valid `PERCY_IOS_DRIVER_HOST_PORT` env → inject that
//      value (preserves BS-host injection where the env arrives via
//      `cli_manager.rb#start_percy_cli`, though that path doesn't reach
//      `app:exec`; preserves self-hosted customer pinning).
//   4. Otherwise → ask the OS for a free port via `pickFreePort()` and
//      write it back to `process.env.PERCY_IOS_DRIVER_HOST_PORT` so the
//      @percy/core relay reads the same value.
//
// On any internal failure (extremely unlikely — only if `pickFreePort`
// throws), emit a WARN and skip the inject so the customer still gets a
// maestro test run, just without iOS element-region support.
export async function maybeInjectDriverHostPort(ctx, log) {
  const args = ctx?.argv;
  if (!Array.isArray(args) || args.length < 2) return;
  if (path.basename(args[0]) !== 'maestro') return;
  if (args[1] !== 'test') return;
  if (hasExistingDriverHostPortFlag(args)) return;
  if (hasShardingFlag(args)) return;

  let port = parseDriverHostPortEnv(process.env.PERCY_IOS_DRIVER_HOST_PORT);
  if (port === null) {
    try {
      port = await pickFreePort();
    } catch (err) {
      /* istanbul ignore next — pickFreePort rejection is reachable only on
         systems with no free ephemeral ports, an effectively impossible
         state. The WARN-and-skip path is defensive insurance. */
      log?.warn(
        `Could not auto-pick a Maestro driver host port (${err?.code || err?.message || err}); ` +
        '--driver-host-port not injected. iOS element regions may be unavailable. ' +
        'Set PERCY_IOS_DRIVER_HOST_PORT to a known-free port to override.'
      );
      return;
    }
    process.env.PERCY_IOS_DRIVER_HOST_PORT = String(port);
  }

  args.splice(2, 0, '--driver-host-port', String(port));
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
  // Each helper splices at index 2, so later calls push earlier flag
  // groups to higher indices. Final argv for `maestro test flow.yaml`:
  //   maestro test --driver-host-port <N> --test-output-dir <dir>
  //     -e PERCY_SERVER=<url> flow.yaml
  // All flag groups land between `test` and the flow file, which Maestro
  // accepts. The driver-host-port helper is async (it may need to ask
  // the OS for a free port), so we await it; the other two are sync.
  maybeInjectMaestroServer(ctx, ctx.log);
  maybeInjectScreenshotDir(ctx, ctx.log);
  await maybeInjectDriverHostPort(ctx, ctx.log);
  yield* ExecPlugin.default.callback(ctx);
});

export default exec;
