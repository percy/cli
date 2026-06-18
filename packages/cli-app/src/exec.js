import fs from 'fs';
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

// Locate the `test` subcommand in argv. Maestro accepts global parent
// flags before the subcommand, e.g.:
//   maestro test flow.yaml
//   maestro --udid <serial> test flow.yaml
//   maestro --platform=android test flow.yaml
//   maestro --verbose --no-ansi test flow.yaml
// We must find `test` by scanning rather than checking args[1] === 'test',
// or our injects silently no-op when the customer pins a device.
//
// Returns the index of the `test` literal, or -1 if not present. Skips
// over the value of known value-taking parent flags so a literal `test`
// supplied as a flag value (e.g. `--udid test`) isn't mistaken for the
// subcommand. Equals-form (`--flag=value`) doesn't need a skip — the
// value is part of the same argv token.
const MAESTRO_PARENT_VALUE_FLAGS = new Set([
  '--udid', '--device', '-p', '--platform',
  '--host', '--port', '--driver-host-port'
]);
function findTestSubcommandIdx(args) {
  for (let i = 1; i < args.length; i++) {
    const tok = args[i];
    if (tok === 'test') return i;
    if (typeof tok === 'string' && MAESTRO_PARENT_VALUE_FLAGS.has(tok)) {
      i++; // skip the value of this flag
    }
  }
  return -1;
}

function hasExistingPercyServerFlag(args, testIdx) {
  for (let i = testIdx + 1; i < args.length - 1; i++) {
    if (args[i] === '-e' && /^PERCY_SERVER=/.test(args[i + 1])) return true;
  }
  return false;
}

// Returns the customer-supplied value of `--test-output-dir` (whether the
// space-form `--test-output-dir <path>` or the equals-form
// `--test-output-dir=<path>` — both are valid picocli syntax), or null if
// absent. Returning the value (not just an index) lets the screenshot-dir
// helper align PERCY_MAESTRO_SCREENSHOT_DIR with the customer's value in
// either form without re-deriving it.
const TEST_OUTPUT_DIR_EQ_PREFIX = '--test-output-dir=';
function findTestOutputDirValue(args, testIdx) {
  for (let i = testIdx + 1; i < args.length; i++) {
    const tok = args[i];
    if (tok === '--test-output-dir' && i + 1 < args.length) return args[i + 1];
    if (typeof tok === 'string' && tok.startsWith(TEST_OUTPUT_DIR_EQ_PREFIX)) {
      return tok.slice(TEST_OUTPUT_DIR_EQ_PREFIX.length);
    }
  }
  return null;
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
  const testIdx = findTestSubcommandIdx(args);
  if (testIdx < 0) return;
  if (hasExistingPercyServerFlag(args, testIdx)) return;
  const addr = ctx.percy?.address();
  if (!addr) {
    log?.warn(
      'app:exec did not start the Percy CLI server (percy disabled or start ' +
      'failed); -e PERCY_SERVER not injected into maestro test. Snapshots will ' +
      'NOT be uploaded. Set PERCY_TOKEN and re-run, or check the percy log above.'
    );
    return;
  }
  // Inject after `test` so `-e KEY=VAL` is bound to the `test` subcommand
  // (the only Maestro subcommand that accepts `-e`).
  args.splice(testIdx + 1, 0, '-e', `PERCY_SERVER=${addr}`);
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
  const testIdx = findTestSubcommandIdx(args);
  if (testIdx < 0) return;

  const envSet = !!process.env.PERCY_MAESTRO_SCREENSHOT_DIR;
  const existingFlagValue = findTestOutputDirValue(args, testIdx);
  const flagSet = existingFlagValue !== null;

  // Fully customer-controlled — nothing to do.
  if (envSet && flagSet) return;

  let resolved;
  if (envSet) {
    resolved = process.env.PERCY_MAESTRO_SCREENSHOT_DIR;
  } else if (flagSet) {
    resolved = existingFlagValue;
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
  // Inject right after `test` (the subcommand that owns `--test-output-dir`).
  if (!flagSet) args.splice(testIdx + 1, 0, '--test-output-dir', resolved);
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
