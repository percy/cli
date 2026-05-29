import { setupTest } from '@percy/cli-command/test/helpers';
import * as ExecPlugin from '@percy/cli-exec';
import { exec, start, stop, ping, maybeInjectMaestroServer } from '@percy/cli-app';

describe('percy app:exec', () => {
  beforeEach(async () => {
    await setupTest();
  });

  it('wraps cli-exec callbacks while preserving differing definitions', async () => {
    // exec.callback wraps cli-exec's callback (auto-injects -e PERCY_SERVER
    // for `maestro test`), so it is no longer reference-equal — but start,
    // stop, and ping remain straight delegations.
    expect(typeof exec.callback).toBe('function');
    expect(exec.callback).not.toEqual(ExecPlugin.default.callback);
    expect(exec.definition).not.toEqual(ExecPlugin.default.definition);
    expect(start.callback).toEqual(ExecPlugin.start.callback);
    expect(start.definition).not.toEqual(ExecPlugin.start.definition);
    // stop and ping are actually exact references
    expect(stop).toEqual(ExecPlugin.stop);
    expect(ping).toEqual(ExecPlugin.ping);
  });

  it('does not accept asset discovery options', async () => {
    await expectAsync(exec(['--allowed-hostname', 'percy.io']))
      .toBeRejectedWithError("Unknown option '--allowed-hostname'");
    await expectAsync(start(['--network-idle-timeout', '500']))
      .toBeRejectedWithError("Unknown option '--network-idle-timeout'");
  });

  describe('maybeInjectMaestroServer', () => {
    function ctxFor(argv, addr = 'http://localhost:5338') {
      return {
        argv: [...argv],
        percy: { address: () => addr }
      };
    }

    it('injects -e PERCY_SERVER at index 2 for `maestro test`', () => {
      const ctx = ctxFor(['maestro', 'test', 'flow.yaml']);
      maybeInjectMaestroServer(ctx);
      expect(ctx.argv).toEqual([
        'maestro', 'test', '-e', 'PERCY_SERVER=http://localhost:5338', 'flow.yaml'
      ]);
    });

    it('preserves other -e flags and customer args after injection', () => {
      const ctx = ctxFor([
        'maestro', 'test', '--test-output-dir', 'out',
        '-e', 'PERCY_DEVICE_NAME=Pixel 10', 'flow.yaml'
      ]);
      maybeInjectMaestroServer(ctx);
      expect(ctx.argv).toEqual([
        'maestro', 'test',
        '-e', 'PERCY_SERVER=http://localhost:5338',
        '--test-output-dir', 'out',
        '-e', 'PERCY_DEVICE_NAME=Pixel 10',
        'flow.yaml'
      ]);
    });

    it('skips when customer already supplied -e PERCY_SERVER (adjacent to test)', () => {
      const argv = ['maestro', 'test', '-e', 'PERCY_SERVER=http://custom:9999', 'flow.yaml'];
      const ctx = ctxFor(argv);
      maybeInjectMaestroServer(ctx);
      expect(ctx.argv).toEqual(argv);
    });

    it('skips when customer supplied -e PERCY_SERVER deeper in args (R3 scan)', () => {
      const argv = [
        'maestro', 'test', '--test-output-dir', 'out',
        '-e', 'PERCY_SERVER=http://custom:9999', 'flow.yaml'
      ];
      const ctx = ctxFor(argv);
      maybeInjectMaestroServer(ctx);
      expect(ctx.argv).toEqual(argv);
    });

    it('skips for `maestro hierarchy` (not a test command)', () => {
      const argv = ['maestro', 'hierarchy', '--udid', 'X'];
      const ctx = ctxFor(argv);
      maybeInjectMaestroServer(ctx);
      expect(ctx.argv).toEqual(argv);
    });

    it('skips for `maestro list-devices` (not a test command)', () => {
      const argv = ['maestro', 'list-devices'];
      const ctx = ctxFor(argv);
      maybeInjectMaestroServer(ctx);
      expect(ctx.argv).toEqual(argv);
    });

    it('skips when args has fewer than two elements', () => {
      const argv = ['maestro'];
      const ctx = ctxFor(argv);
      maybeInjectMaestroServer(ctx);
      expect(ctx.argv).toEqual(argv);
    });

    it('matches by basename when the command is an absolute path', () => {
      const ctx = ctxFor(['/Users/foo/.maestro/bin/maestro', 'test', 'flow.yaml']);
      maybeInjectMaestroServer(ctx);
      expect(ctx.argv).toEqual([
        '/Users/foo/.maestro/bin/maestro', 'test',
        '-e', 'PERCY_SERVER=http://localhost:5338',
        'flow.yaml'
      ]);
    });

    it('skips for `npx maestro test` (argv[0] is npx, not maestro)', () => {
      const argv = ['npx', 'maestro', 'test', 'flow.yaml'];
      const ctx = ctxFor(argv);
      maybeInjectMaestroServer(ctx);
      expect(ctx.argv).toEqual(argv);
    });

    it('skips for non-maestro commands (python, appium, etc.)', () => {
      const pyArgv = ['python', 'test.py'];
      const pyCtx = ctxFor(pyArgv);
      maybeInjectMaestroServer(pyCtx);
      expect(pyCtx.argv).toEqual(pyArgv);

      const apiumArgv = ['appium', '--port', '4723'];
      const apiumCtx = ctxFor(apiumArgv);
      maybeInjectMaestroServer(apiumCtx);
      expect(apiumCtx.argv).toEqual(apiumArgv);
    });

    it('flows --port through into the injected address (multi-device)', () => {
      const ctx = ctxFor(['maestro', 'test', 'flow.yaml'], 'http://localhost:5339');
      maybeInjectMaestroServer(ctx);
      expect(ctx.argv).toEqual([
        'maestro', 'test', '-e', 'PERCY_SERVER=http://localhost:5339', 'flow.yaml'
      ]);
    });

    it('skips when percy is disabled (no address)', () => {
      const argv = ['maestro', 'test', 'flow.yaml'];
      const ctx = { argv: [...argv], percy: { address: () => undefined } };
      maybeInjectMaestroServer(ctx);
      expect(ctx.argv).toEqual(argv);
    });

    it('skips when ctx has no percy at all', () => {
      const argv = ['maestro', 'test', 'flow.yaml'];
      const ctx = { argv: [...argv] };
      maybeInjectMaestroServer(ctx);
      expect(ctx.argv).toEqual(argv);
    });

    it('two concurrent contexts pick their own addresses (multi-device isolation)', () => {
      const a = ctxFor(['maestro', 'test', 'flow.yaml'], 'http://localhost:5338');
      const b = ctxFor(['maestro', 'test', 'flow.yaml'], 'http://localhost:5339');
      maybeInjectMaestroServer(a);
      maybeInjectMaestroServer(b);
      expect(a.argv).toContain('PERCY_SERVER=http://localhost:5338');
      expect(b.argv).toContain('PERCY_SERVER=http://localhost:5339');
      expect(a.argv).not.toContain('PERCY_SERVER=http://localhost:5339');
      expect(b.argv).not.toContain('PERCY_SERVER=http://localhost:5338');
    });
  });
});
