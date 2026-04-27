import logger from '@percy/logger';
import PercyConfig from '@percy/config';
import { set, del } from '@percy/config/utils';
import { generatePromise, AbortController, AbortError, redactSecrets } from '@percy/core/utils';
import * as CoreConfig from '@percy/core/config';
import * as builtInFlags from './flags.js';
import formatHelp from './help.js';
import parse from './parse.js';

// PER-7855 Phase 3: module-level shutdown state for graceful drain on
// SIGINT/SIGTERM. Per-run signal handlers (registered in
// runCommandWithContext below) delegate here so the state is accessible
// to commands via ctx.shutdown without prop-drilling.
//
// The state is intentionally module-level (not per-runner) so that a
// process-wide `process.on('exit')` cleanup can read it. Tests reset
// via the exported `_resetShutdownForTest()` helper.
let shutdownState = {
  signal: null, // 'SIGINT' / 'SIGTERM' once received, null otherwise
  forced: false, // escalates on second signal or 30s drain timeout
  drainTimer: null,
  hardExitTimer: null
};

// Tracks the active context so the global unhandled-rejection handler
// can flag the run as failed without requiring the command to plumb
// state through. Reset between runs (and between tests).
let activeContext = null;

const DEFAULT_DRAIN_MS = 30_000;
const HARD_EXIT_AFTER_FORCE_MS = 5_000;

// Begin or escalate drain. Idempotent on the same signal.
function beginShutdown(signal) {
  // Only SIGINT/SIGTERM trigger drain semantics (origin scope).
  // Other signals fall through to the per-run AbortController without
  // setting drain state.
  if (signal !== 'SIGINT' && signal !== 'SIGTERM') return;

  if (shutdownState.signal) {
    // Second signal: escalate to forced and arm hard-exit fallback in
    // case the in-flight stop hangs.
    shutdownState.forced = true;
    /* istanbul ignore else: timer guard against doubled escalation */
    if (!shutdownState.hardExitTimer) {
      shutdownState.hardExitTimer = setTimeout(
        /* istanbul ignore next: hard-exit only fires when stop hangs */
        () => process.exit(signal === 'SIGINT' ? 130 : 143),
        HARD_EXIT_AFTER_FORCE_MS
      ).unref();
    }
    logger('cli').error(
      `${signal} received again; force-exiting.`
    );
    return;
  }

  shutdownState.signal = signal;
  logger('cli').warn(
    `${signal} received, draining (press Ctrl-C again to force)...`
  );
  // 30s drain budget: if percy.stop(false) hasn't completed, escalate
  // to forced. Subsequent stop calls (or the hard-exit timer) take it
  // from there.
  shutdownState.drainTimer = setTimeout(
    () => { shutdownState.forced = true; },
    DEFAULT_DRAIN_MS
  ).unref();
}

// Global handlers for unhandled rejection / uncaught exception. The
// stack is routed through redactSecrets because CDP rejections can
// include serialized page-script bodies, Authorization headers, or
// cookie strings.
function onUnhandled(label, err) {
  let stackOrMsg;
  /* istanbul ignore else: err is almost always an Error */
  if (err && (err.stack || err.message)) {
    stackOrMsg = redactSecrets(err.stack ?? err.message);
  } else {
    stackOrMsg = redactSecrets(String(err));
  }
  logger('cli').error(`${label}: ${stackOrMsg}`);
  if (activeContext) activeContext.runFailed = true;
}

// Attach process-wide handlers exactly once per Node process. Repeated
// invocations of the command runner (e.g., back-to-back tests) reuse
// the same handlers.
let _processHandlersAttached = false;
function ensureProcessHandlers() {
  if (_processHandlersAttached) return;
  process.on('unhandledRejection', err => onUnhandled('Unhandled promise rejection', err));
  process.on('uncaughtException', err => onUnhandled('Uncaught exception', err));
  _processHandlersAttached = true;
}

// Test-only: reset module-level state between specs. Without this,
// shutdownState.signal stuck from one spec leaks into the next.
export function _resetShutdownForTest() {
  if (shutdownState.drainTimer) clearTimeout(shutdownState.drainTimer);
  if (shutdownState.hardExitTimer) clearTimeout(shutdownState.hardExitTimer);
  shutdownState = { signal: null, forced: false, drainTimer: null, hardExitTimer: null };
  activeContext = null;
}

// Copies a command definition and adds built-in flags and config options.
function withBuiltIns(definition) {
  let def = { ...definition };
  def.flags = [...(def.flags ?? [])];

  // ensure built-ins aren't already overridden
  let addDedupedFlag = flag => {
    if (!def.flags.find(f => f.name === flag.name)) {
      let short = def.flags.find(f => f.short === flag.short);
      def.flags.push(short ? del({ ...flag }, 'short') : flag);
    }
  };

  // add percy specific built-in flags
  if (def.percy && def.percy !== true) {
    builtInFlags.PERCY.forEach(addDedupedFlag);

    // maybe include percy server flags
    if (def.percy.server === true) {
      builtInFlags.SERVER.forEach(addDedupedFlag);
    }

    // maybe include percy discovery flags
    if (def.percy.skipDiscovery !== true) {
      builtInFlags.DISCOVERY.forEach(addDedupedFlag);
    }
  }

  // always add global built-in flags
  builtInFlags.GLOBAL.forEach(addDedupedFlag);

  // copy any existing config before adding to it
  def.config = { ...def.config };
  def.config.schemas = [...(def.config.schemas ?? [])];
  def.config.migrations = [...(def.config.migrations ?? [])];

  // add percy specific built-in config options
  if (def.percy) {
    def.config.schemas.unshift(CoreConfig.schemas);
    def.config.migrations.unshift(CoreConfig.migrations);
  }

  return def;
}

// Helper to throw an error with an exit code and optional reason message
function exit(exitCode, reason = '', shouldOverrideExitCode = true) {
  let percyExitWithZeroOnError = process.env.PERCY_EXIT_WITH_ZERO_ON_ERROR === 'true';
  exitCode = percyExitWithZeroOnError && shouldOverrideExitCode ? 0 : exitCode;
  let err = reason instanceof Error ? reason : new Error(reason);
  // Adding additional object so that it can be used in runner function below.
  err.shouldOverrideExitCode = shouldOverrideExitCode;
  throw Object.assign(err, { exitCode });
}

// Runs the parsed command callback with a contextual argument consisting of specific parsed input
// and other common command helpers and properties.
async function runCommandWithContext(parsed) {
  // PER-7855 Phase 3: reset shutdown state at the start of each run so
  // that a `process.emit('SIGINT')` left over from a previous spec
  // does not leak `shutdownState.signal` into a fresh test run. In
  // production (one runner invocation per Node process), this is a
  // no-op the first time around.
  if (shutdownState.signal || shutdownState.forced) {
    if (shutdownState.drainTimer) clearTimeout(shutdownState.drainTimer);
    if (shutdownState.hardExitTimer) clearTimeout(shutdownState.hardExitTimer);
    shutdownState = { signal: null, forced: false, drainTimer: null, hardExitTimer: null };
  }

  let { command, flags, args, argv, log } = parsed;
  // include flags, args, argv, logger, exit helper, and env info
  // PER-7855 Phase 3: ctx.shutdown exposes the module-level shutdown
  // state to commands so they can call `percy.stop(ctx.shutdown.forced)`
  // for graceful-on-first-signal, force-on-second-signal behavior.
  let context = { flags, args, argv, log, exit, shutdown: shutdownState, runFailed: false };
  let env = context.env = process.env;
  let pkg = command.packageInformation;
  let def = command.definition;
  // Track this run for the global unhandled-rejection handler.
  activeContext = context;
  ensureProcessHandlers();

  // automatically include a preconfigured percy instance
  if (def.percy) {
    let { Percy } = await import('@percy/core');

    // shallow merge with default options
    let conf = { server: false, ...def.percy };
    if (pkg) conf.clientInfo ||= `${pkg.name}/${pkg.version}`;
    conf.environmentInfo ||= `node/${process.version}`;

    Object.defineProperty(context, 'percy', {
      configurable: true,

      get() {
        // percy is disabled, do not return an instance
        if (env.PERCY_ENABLE === '0') return;

        // redefine the context property once configured
        Object.defineProperty(context, 'percy', {
          // map and merge percy arguments with config options
          value: new Percy([...parsed.operators.entries()]
            .reduce((conf, [opt, value]) => opt.percyrc ? (
              set(conf, opt.percyrc, value)) : conf, conf))
        });

        return context.percy;
      }
    });
  }

  // process signals will abort. PER-7855 Phase 3: SIGINT/SIGTERM also
  // engage the module-level shutdown state for drain semantics; the
  // existing AbortError unwind path is preserved unchanged so commands
  // that already catch AbortError keep working. AbortController.abort
  // is idempotent — re-entry on a second SIGINT during the same run
  // is benign for the controller and required for the drain
  // escalation in beginShutdown.
  let ctrl = new AbortController();
  let signals = ['SIGUSR1', 'SIGUSR2', 'SIGTERM', 'SIGINT', 'SIGHUP'].map(signal => {
    let handler = () => {
      beginShutdown(signal);
      ctrl.abort(new AbortError(signal, { signal, exitCode: 0 }));
    };
    handler.off = () => process.off(signal, handler);
    process.on(signal, handler);
    return handler;
  });

  // run the command callback with context and cleanup handlers after
  try {
    await generatePromise(command.callback(context), ctrl.signal, error => {
      for (let handler of signals) handler.off();
      if (error) throw error;
    });
  } finally {
    // Belt-and-suspenders: ensure handlers are removed even on paths
    // where generatePromise's cleanup callback didn't fire, so
    // back-to-back test runs don't accumulate listeners.
    for (let handler of signals) handler.off();
    // Clear active context so a subsequent unhandled rejection (e.g.
    // from a leaked promise after this command completed) is not
    // attributed to it.
    if (activeContext === context) activeContext = null;
  }
  // PER-7855 Phase 3: if a global unhandled rejection fired during
  // this run (and the command did not itself throw), fail loudly at
  // the end so CI does not see a green build. Pre-existing thrown
  // errors are preserved by the fact that we only reach here on
  // success.
  if (context.runFailed) {
    throw Object.assign(new Error('Run failed: see preceding logs for details'), { exitCode: 1 });
  }
}

// Returns a command runner function that when run will parse provided command-line options and run
// the parsed command callback. The returned runner will automatically output version and help
// information when requested, and handle any thrown errors exiting when appropriate.
export function command(name, definition, callback) {
  definition = withBuiltIns(definition);

  // auto register config schemas and migrations
  PercyConfig.addSchema(definition.config.schemas);
  PercyConfig.addMigration(definition.config.migrations);

  async function runner(argv = []) {
    // reset loglevel for testing
    logger.loglevel('info');
    let log = logger('cli');

    try {
      // parse input
      let parsed = await parse(runner, argv);

      if (parsed.version) {
        // version requested
        log.stdout.write(parsed.command.definition.version + '\n');
      } else if (parsed.help || !parsed.command.callback) {
        // command help requested
        log.stdout.write(await formatHelp(parsed.command) + '\n');
      } else {
        // run command callback
        await runCommandWithContext(parsed);
      }
    } catch (err) {
      // auto log unhandled error messages
      if (err.message && !err.signal) {
        if (err.exitCode === 0) log.warn(err.message);
        else log.error(err);
      }

      // PER-7855 Phase 3: signal-driven shutdown — when SIGINT/SIGTERM
      // was received during this run, exit with the signal-derived
      // code (130 / 143) in production. Tests with `exitOnError: false`
      // preserve the legacy clean-resolution behavior because
      // AbortError carries exitCode:0 and the gate below is skipped.
      if (shutdownState.signal && err.signal && definition.exitOnError) {
        let signalCode = shutdownState.signal === 'SIGINT' ? 130 : 143;
        let percyExitWithZeroOnError = process.env.PERCY_EXIT_WITH_ZERO_ON_ERROR === 'true';
        process.exit(percyExitWithZeroOnError ? 0 : signalCode);
      }

      // exit when appropriate
      if (err.exitCode !== 0) {
        err.exitCode ??= 1;
        err.message ||= `EEXIT: ${err.exitCode}`;

        if (definition.exitOnError) {
          let shouldOverrideExitCode = err.shouldOverrideExitCode !== false;
          let percyExitWithZeroOnError = process.env.PERCY_EXIT_WITH_ZERO_ON_ERROR === 'true';
          let exitCode = percyExitWithZeroOnError && shouldOverrideExitCode ? 0 : err.exitCode;
          process.exit(exitCode);
        }

        // re-throw when not exiting
        throw err;
      }
    }
  }

  // define command meta information
  Object.defineProperties(runner, {
    name: { enumerable: true, value: name },
    definition: { enumerable: true, value: definition },
    callback: { enumerable: true, value: callback }
  });

  return runner;
}

export default command;
