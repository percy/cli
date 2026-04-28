import logger from '@percy/logger/test/helpers';
import command, { _resetShutdownForTest } from '@percy/cli-command';

// PER-7855 Phase 3: signal handling, unhandled-rejection logging with
// redaction, and exit-code precedence. Tests stub `process.exit` so
// the runner's exit-code branch can be observed without actually
// killing the test runner.
describe('Phase 3: shutdown + unhandled-rejection + exit codes', () => {
  let exitSpy;

  beforeEach(async () => {
    await logger.mock();
    _resetShutdownForTest();
    // Stub process.exit so the production-mode signal branch (which
    // calls process.exit synchronously) returns instead of killing
    // the test runner. Throwing a sentinel so the catch unwinds the
    // command's try/catch as it would on a real exit.
    exitSpy = spyOn(process, 'exit').and.callFake(code => {
      throw Object.assign(new Error('SIMULATED_PROCESS_EXIT'), { exitCode: code, simulated: true });
    });
  });

  afterEach(() => {
    _resetShutdownForTest();
  });

  describe('signal handling (exitOnError: true — production)', () => {
    function makeRunner() {
      return command('graceful-stop', { exitOnError: true }, async function*() {
        // Run forever until aborted.
        while (true) yield new Promise(r => setImmediate(r));
      });
    }

    it('exits with 130 on SIGINT', async () => {
      let runner = makeRunner();
      let promise = runner();
      await new Promise(r => setImmediate(r));
      process.emit('SIGINT');
      await promise.catch(() => {});

      expect(exitSpy).toHaveBeenCalledWith(130);
    });

    it('exits with 143 on SIGTERM', async () => {
      let runner = makeRunner();
      let promise = runner();
      await new Promise(r => setImmediate(r));
      process.emit('SIGTERM');
      await promise.catch(() => {});

      expect(exitSpy).toHaveBeenCalledWith(143);
    });
  });

  describe('shutdown.forced exposes drain state to commands', () => {
    it('starts false on first signal and flips to true on second', async () => {
      // Capture the ctx.shutdown reference from the generator so we
      // can observe its state from the test after each signal.
      // Reading inside the generator doesn't work — AbortError unwinds
      // the generator on the first signal before we can sample.
      let captured;
      let runner = command('grab-shutdown', {}, async function*({ shutdown }) {
        captured = shutdown;
        while (true) yield new Promise(r => setImmediate(r));
      });

      let promise = runner();
      await new Promise(r => setImmediate(r));
      expect(captured.signal).toBe(null);
      expect(captured.forced).toBe(false);

      process.emit('SIGINT');
      // Sample synchronously — beginShutdown ran inside the signal
      // handler before we re-entered the test continuation.
      expect(captured.signal).toBe('SIGINT');
      expect(captured.forced).toBe(false);

      process.emit('SIGINT');
      // Second signal flips forced.
      expect(captured.forced).toBe(true);

      await promise.catch(() => {});
    });
  });

  describe('unhandled rejection redaction', () => {
    // Direct-handler test: bypassing Jasmine's own
    // unhandledRejection tracker (which would auto-fail the spec) by
    // invoking our registered handler directly.
    it('routes the error stack through redactSecrets before logging', async () => {
      // Run a no-op command first so the global handlers attach.
      let noop = command('noop', {}, async function*() { yield 0; });
      await noop().catch(() => {});

      // Find our handler in the registered listeners (it's attached
      // exactly once by ensureProcessHandlers).
      let listeners = process.listeners('unhandledRejection');
      expect(listeners.length).toBeGreaterThan(0);
      let percyHandler = listeners[listeners.length - 1];

      let leakedAwsKey = 'AKIAIOSFODNN7EXAMPLE';
      let err = new Error(`Failed with key ${leakedAwsKey}`);

      // Invoke directly — this routes through redactSecrets without
      // triggering Jasmine's own rejection tracker.
      percyHandler(err);
      // Allow any async logger writes to flush.
      await new Promise(r => setImmediate(r));

      let combined = logger.stderr.join('\n');
      expect(combined).toContain('Unhandled promise rejection');
      expect(combined).toContain('[REDACTED]');
      expect(combined).not.toContain(leakedAwsKey);
    });

    // Coverage: the runner re-throws a synthetic exit-1 error when a
    // command completes successfully but a global rejection set
    // ctx.runFailed=true mid-run. Verifies the post-success branch.
    it('throws a synthetic exit-1 error when runFailed is set mid-run', async () => {
      // A command that completes successfully but pretends an
      // unhandled rejection set runFailed during its run.
      let runner = command('completes-with-runfailed', {}, async function*({ shutdown }) {
        // Reach into module-level activeContext via the
        // unhandledRejection handler entry point — same code path
        // production uses.
        let listeners = process.listeners('unhandledRejection');
        if (listeners.length) listeners[listeners.length - 1](new Error('flaky cdp'));
        yield 0;
      });

      let err;
      try { await runner(); } catch (e) { err = e; }
      expect(err).toBeDefined();
      expect(err.exitCode).toBe(1);
      expect(err.message).toMatch(/Run failed/);
    });
  });

});
