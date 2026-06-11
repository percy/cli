import fs from 'fs';
import net from 'net';
import os from 'os';
import path from 'path';
import { setupTest } from '@percy/cli-command/test/helpers';
import * as ExecPlugin from '@percy/cli-exec';
import {
  exec, start, stop, ping,
  maybeInjectMaestroServer, maybeInjectScreenshotDir, maybeInjectDriverHostPort
} from '@percy/cli-app';

describe('percy app:exec', () => {
  beforeEach(async () => {
    await setupTest();
  });

  it('wraps cli-exec callbacks while preserving differing definitions', async () => {
    // exec.callback wraps cli-exec's callback (auto-injects -e PERCY_SERVER
    // and --test-output-dir for `maestro test`), so it is no longer reference-
    // equal — but start, stop, and ping remain straight delegations.
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

    it('emits WARN log when percy address is falsy and there is no customer override', () => {
      const log = { warn: jasmine.createSpy('warn') };
      const ctx = { argv: ['maestro', 'test', 'flow.yaml'], percy: { address: () => undefined } };
      maybeInjectMaestroServer(ctx, log);
      expect(log.warn).toHaveBeenCalledTimes(1);
      expect(log.warn.calls.argsFor(0)[0]).toContain('-e PERCY_SERVER not injected');
    });

    it('does NOT emit WARN when customer-supplied -e PERCY_SERVER override is present', () => {
      const log = { warn: jasmine.createSpy('warn') };
      const ctx = {
        argv: ['maestro', 'test', '-e', 'PERCY_SERVER=http://custom:9999', 'flow.yaml'],
        percy: { address: () => undefined }
      };
      maybeInjectMaestroServer(ctx, log);
      expect(log.warn).not.toHaveBeenCalled();
    });
  });

  describe('maybeInjectScreenshotDir', () => {
    let originalEnvValue;

    beforeEach(() => {
      originalEnvValue = process.env.PERCY_MAESTRO_SCREENSHOT_DIR;
      delete process.env.PERCY_MAESTRO_SCREENSHOT_DIR;
    });

    afterEach(() => {
      if (originalEnvValue === undefined) {
        delete process.env.PERCY_MAESTRO_SCREENSHOT_DIR;
      } else {
        process.env.PERCY_MAESTRO_SCREENSHOT_DIR = originalEnvValue;
      }
    });

    function ctxFor(argv) {
      return { argv: [...argv] };
    }

    it('injects --test-output-dir and sets env var to <CWD>/.percy-out on happy path', () => {
      const mkdir = spyOn(fs, 'mkdirSync').and.callFake(() => {});
      const expectedDir = path.join(process.cwd(), '.percy-out');
      const ctx = ctxFor(['maestro', 'test', 'flow.yaml']);
      maybeInjectScreenshotDir(ctx);
      expect(mkdir).toHaveBeenCalledWith(expectedDir, { recursive: true });
      expect(process.env.PERCY_MAESTRO_SCREENSHOT_DIR).toBe(expectedDir);
      expect(ctx.argv).toEqual([
        'maestro', 'test', '--test-output-dir', expectedDir, 'flow.yaml'
      ]);
    });

    it('honors customer-set PERCY_MAESTRO_SCREENSHOT_DIR and injects flag aligned to it', () => {
      process.env.PERCY_MAESTRO_SCREENSHOT_DIR = '/custom/screenshot/dir';
      const mkdir = spyOn(fs, 'mkdirSync').and.callFake(() => {});
      const ctx = ctxFor(['maestro', 'test', 'flow.yaml']);
      maybeInjectScreenshotDir(ctx);
      expect(mkdir).not.toHaveBeenCalled();
      expect(process.env.PERCY_MAESTRO_SCREENSHOT_DIR).toBe('/custom/screenshot/dir');
      expect(ctx.argv).toEqual([
        'maestro', 'test', '--test-output-dir', '/custom/screenshot/dir', 'flow.yaml'
      ]);
    });

    it('honors customer-supplied --test-output-dir and mirrors value into env var', () => {
      const mkdir = spyOn(fs, 'mkdirSync').and.callFake(() => {});
      const ctx = ctxFor(['maestro', 'test', '--test-output-dir', '/custom/path', 'flow.yaml']);
      maybeInjectScreenshotDir(ctx);
      expect(mkdir).not.toHaveBeenCalled();
      expect(process.env.PERCY_MAESTRO_SCREENSHOT_DIR).toBe('/custom/path');
      // argv unchanged — customer's flag stays where they put it
      expect(ctx.argv).toEqual(['maestro', 'test', '--test-output-dir', '/custom/path', 'flow.yaml']);
    });

    it('skips entirely when both env var and --test-output-dir are customer-set', () => {
      process.env.PERCY_MAESTRO_SCREENSHOT_DIR = '/from/env';
      const mkdir = spyOn(fs, 'mkdirSync').and.callFake(() => {});
      const argv = ['maestro', 'test', '--test-output-dir', '/from/flag', 'flow.yaml'];
      const ctx = ctxFor(argv);
      maybeInjectScreenshotDir(ctx);
      expect(mkdir).not.toHaveBeenCalled();
      expect(process.env.PERCY_MAESTRO_SCREENSHOT_DIR).toBe('/from/env');
      expect(ctx.argv).toEqual(argv);
    });

    it('falls back to <TMPDIR>/percy-maestro-<pid> on EACCES and emits WARN', () => {
      const mkdir = spyOn(fs, 'mkdirSync').and.callFake((dirPath) => {
        if (dirPath === path.join(process.cwd(), '.percy-out')) {
          const err = new Error('EACCES'); err.code = 'EACCES';
          throw err;
        }
      });
      const log = { warn: jasmine.createSpy('warn') };
      const ctx = ctxFor(['maestro', 'test', 'flow.yaml']);
      maybeInjectScreenshotDir(ctx, log);
      const fallback = path.join(os.tmpdir(), `percy-maestro-${process.pid}`);
      expect(mkdir).toHaveBeenCalledWith(fallback, { recursive: true });
      expect(process.env.PERCY_MAESTRO_SCREENSHOT_DIR).toBe(fallback);
      expect(ctx.argv).toEqual([
        'maestro', 'test', '--test-output-dir', fallback, 'flow.yaml'
      ]);
      expect(log.warn).toHaveBeenCalledTimes(1);
      expect(log.warn.calls.argsFor(0)[0]).toContain('EACCES');
      expect(log.warn.calls.argsFor(0)[0]).toContain(fallback);
    });

    it('falls back on EROFS (read-only filesystem)', () => {
      spyOn(fs, 'mkdirSync').and.callFake((dirPath) => {
        if (dirPath === path.join(process.cwd(), '.percy-out')) {
          const err = new Error('EROFS'); err.code = 'EROFS';
          throw err;
        }
      });
      const log = { warn: jasmine.createSpy('warn') };
      const ctx = ctxFor(['maestro', 'test', 'flow.yaml']);
      maybeInjectScreenshotDir(ctx, log);
      const fallback = path.join(os.tmpdir(), `percy-maestro-${process.pid}`);
      expect(process.env.PERCY_MAESTRO_SCREENSHOT_DIR).toBe(fallback);
      expect(log.warn).toHaveBeenCalled();
    });

    it('falls back on EEXIST (.percy-out collides with a non-directory)', () => {
      spyOn(fs, 'mkdirSync').and.callFake((dirPath) => {
        if (dirPath === path.join(process.cwd(), '.percy-out')) {
          const err = new Error('EEXIST'); err.code = 'EEXIST';
          throw err;
        }
      });
      const log = { warn: jasmine.createSpy('warn') };
      const ctx = ctxFor(['maestro', 'test', 'flow.yaml']);
      maybeInjectScreenshotDir(ctx, log);
      const fallback = path.join(os.tmpdir(), `percy-maestro-${process.pid}`);
      expect(process.env.PERCY_MAESTRO_SCREENSHOT_DIR).toBe(fallback);
      expect(log.warn).toHaveBeenCalled();
    });

    it('skips for `maestro hierarchy` (not a test command)', () => {
      const mkdir = spyOn(fs, 'mkdirSync').and.callFake(() => {});
      const argv = ['maestro', 'hierarchy', '--udid', 'X'];
      const ctx = ctxFor(argv);
      maybeInjectScreenshotDir(ctx);
      expect(mkdir).not.toHaveBeenCalled();
      expect(process.env.PERCY_MAESTRO_SCREENSHOT_DIR).toBeUndefined();
      expect(ctx.argv).toEqual(argv);
    });

    it('skips for `npx maestro test` (argv[0] is npx, not maestro)', () => {
      const mkdir = spyOn(fs, 'mkdirSync').and.callFake(() => {});
      const argv = ['npx', 'maestro', 'test', 'flow.yaml'];
      const ctx = ctxFor(argv);
      maybeInjectScreenshotDir(ctx);
      expect(mkdir).not.toHaveBeenCalled();
      expect(ctx.argv).toEqual(argv);
    });

    it('skips for non-maestro commands', () => {
      const mkdir = spyOn(fs, 'mkdirSync').and.callFake(() => {});
      const argv = ['python', 'test.py'];
      const ctx = ctxFor(argv);
      maybeInjectScreenshotDir(ctx);
      expect(mkdir).not.toHaveBeenCalled();
      expect(ctx.argv).toEqual(argv);
    });

    it('skips when args has fewer than two elements', () => {
      const mkdir = spyOn(fs, 'mkdirSync').and.callFake(() => {});
      const argv = ['maestro'];
      const ctx = ctxFor(argv);
      maybeInjectScreenshotDir(ctx);
      expect(mkdir).not.toHaveBeenCalled();
      expect(ctx.argv).toEqual(argv);
    });

    it('matches by basename when the command is an absolute path', () => {
      const mkdir = spyOn(fs, 'mkdirSync').and.callFake(() => {});
      const expectedDir = path.join(process.cwd(), '.percy-out');
      const ctx = ctxFor(['/Users/foo/.maestro/bin/maestro', 'test', 'flow.yaml']);
      maybeInjectScreenshotDir(ctx);
      expect(mkdir).toHaveBeenCalledWith(expectedDir, { recursive: true });
      expect(ctx.argv).toEqual([
        '/Users/foo/.maestro/bin/maestro', 'test',
        '--test-output-dir', expectedDir,
        'flow.yaml'
      ]);
    });
  });

  describe('maybeInjectDriverHostPort', () => {
    // Prescribe-don't-discover: cli-app injects --driver-host-port so the
    // @percy/core relay can hit the iOS Maestro driver deterministically
    // via the matching PERCY_IOS_DRIVER_HOST_PORT env var. Customer overrides
    // at two layers (argv flag, env var) and the sharded-run gate must all
    // be honored.

    let originalEnvValue;

    beforeEach(() => {
      originalEnvValue = process.env.PERCY_IOS_DRIVER_HOST_PORT;
      delete process.env.PERCY_IOS_DRIVER_HOST_PORT;
    });

    afterEach(() => {
      if (originalEnvValue === undefined) {
        delete process.env.PERCY_IOS_DRIVER_HOST_PORT;
      } else {
        process.env.PERCY_IOS_DRIVER_HOST_PORT = originalEnvValue;
      }
    });

    function ctxFor(argv) {
      return { argv: [...argv] };
    }

    // Helper: a net.createServer stub that emits the listen callback with
    // a fake "address().port" value, then succeeds on close. Mirrors the
    // real shape closely enough for the helper's promise to resolve to
    // `fakePort` without touching real sockets in unit tests.
    function stubNetWithPort(fakePort) {
      return spyOn(net, 'createServer').and.callFake(() => {
        const fakeServer = {
          unref() {},
          once() {},
          listen(_port, _host, cb) { setImmediate(cb); },
          address() { return { port: fakePort }; },
          close(cb) { setImmediate(cb); }
        };
        return fakeServer;
      });
    }

    it('injects --driver-host-port with PERCY_IOS_DRIVER_HOST_PORT env value when set', async () => {
      process.env.PERCY_IOS_DRIVER_HOST_PORT = '7001';
      const created = spyOn(net, 'createServer').and.callThrough();
      const ctx = ctxFor(['maestro', 'test', 'flow.yaml']);
      await maybeInjectDriverHostPort(ctx);
      // Did NOT call net.createServer — env value short-circuits pickFreePort
      expect(created).not.toHaveBeenCalled();
      // env preserved (we use the customer value, don't rewrite it)
      expect(process.env.PERCY_IOS_DRIVER_HOST_PORT).toBe('7001');
      expect(ctx.argv).toEqual([
        'maestro', 'test', '--driver-host-port', '7001', 'flow.yaml'
      ]);
    });

    it('picks a free port and writes env when neither env nor argv flag is set', async () => {
      stubNetWithPort(54321);
      const ctx = ctxFor(['maestro', 'test', 'flow.yaml']);
      await maybeInjectDriverHostPort(ctx);
      expect(process.env.PERCY_IOS_DRIVER_HOST_PORT).toBe('54321');
      expect(ctx.argv).toEqual([
        'maestro', 'test', '--driver-host-port', '54321', 'flow.yaml'
      ]);
    });

    it('skips when customer already passed --driver-host-port in argv', async () => {
      const created = spyOn(net, 'createServer').and.callThrough();
      const argv = ['maestro', 'test', '--driver-host-port', '8000', 'flow.yaml'];
      const ctx = ctxFor(argv);
      await maybeInjectDriverHostPort(ctx);
      expect(created).not.toHaveBeenCalled();
      expect(process.env.PERCY_IOS_DRIVER_HOST_PORT).toBeUndefined();
      expect(ctx.argv).toEqual(argv);
    });

    it('treats invalid env values as absent and falls through to pickFreePort', async () => {
      process.env.PERCY_IOS_DRIVER_HOST_PORT = 'not-a-port';
      stubNetWithPort(40000);
      const ctx = ctxFor(['maestro', 'test', 'flow.yaml']);
      await maybeInjectDriverHostPort(ctx);
      expect(process.env.PERCY_IOS_DRIVER_HOST_PORT).toBe('40000');
      expect(ctx.argv).toEqual([
        'maestro', 'test', '--driver-host-port', '40000', 'flow.yaml'
      ]);
    });

    it('rejects out-of-range env values (70000) and picks a free port', async () => {
      process.env.PERCY_IOS_DRIVER_HOST_PORT = '70000';
      stubNetWithPort(40001);
      const ctx = ctxFor(['maestro', 'test', 'flow.yaml']);
      await maybeInjectDriverHostPort(ctx);
      expect(process.env.PERCY_IOS_DRIVER_HOST_PORT).toBe('40001');
      expect(ctx.argv).toEqual([
        'maestro', 'test', '--driver-host-port', '40001', 'flow.yaml'
      ]);
    });

    it('skips when argv has --shards (would break shard 2+ on a single injected port)', async () => {
      const created = spyOn(net, 'createServer').and.callThrough();
      const argv = ['maestro', 'test', '--shards', '3', 'flow.yaml'];
      const ctx = ctxFor(argv);
      await maybeInjectDriverHostPort(ctx);
      expect(created).not.toHaveBeenCalled();
      expect(process.env.PERCY_IOS_DRIVER_HOST_PORT).toBeUndefined();
      expect(ctx.argv).toEqual(argv);
    });

    it('skips when argv has -s (deprecated short form of --shards)', async () => {
      const created = spyOn(net, 'createServer').and.callThrough();
      const argv = ['maestro', 'test', '-s', '3', 'flow.yaml'];
      const ctx = ctxFor(argv);
      await maybeInjectDriverHostPort(ctx);
      expect(created).not.toHaveBeenCalled();
      expect(ctx.argv).toEqual(argv);
    });

    it('skips when argv has --shard-split', async () => {
      const created = spyOn(net, 'createServer').and.callThrough();
      const argv = ['maestro', 'test', '--shard-split', '3', 'flow.yaml'];
      const ctx = ctxFor(argv);
      await maybeInjectDriverHostPort(ctx);
      expect(created).not.toHaveBeenCalled();
      expect(ctx.argv).toEqual(argv);
    });

    it('skips when argv has --shard-all', async () => {
      const created = spyOn(net, 'createServer').and.callThrough();
      const argv = ['maestro', 'test', '--shard-all', '2', 'flow.yaml'];
      const ctx = ctxFor(argv);
      await maybeInjectDriverHostPort(ctx);
      expect(created).not.toHaveBeenCalled();
      expect(ctx.argv).toEqual(argv);
    });

    it('preserves customer env value when sharded — gates on sharding, does not touch env', async () => {
      process.env.PERCY_IOS_DRIVER_HOST_PORT = '7001';
      const created = spyOn(net, 'createServer').and.callThrough();
      const argv = ['maestro', 'test', '--shard-split', '2', 'flow.yaml'];
      const ctx = ctxFor(argv);
      await maybeInjectDriverHostPort(ctx);
      expect(created).not.toHaveBeenCalled();
      // env left untouched — sharded customers must pin per-shard themselves
      expect(process.env.PERCY_IOS_DRIVER_HOST_PORT).toBe('7001');
      expect(ctx.argv).toEqual(argv);
    });

    it('skips for `maestro hierarchy` (not a test command)', async () => {
      const created = spyOn(net, 'createServer').and.callThrough();
      const argv = ['maestro', 'hierarchy', '--udid', 'X'];
      const ctx = ctxFor(argv);
      await maybeInjectDriverHostPort(ctx);
      expect(created).not.toHaveBeenCalled();
      expect(ctx.argv).toEqual(argv);
    });

    it('skips for non-maestro commands (argv[0] is npx or other)', async () => {
      const created = spyOn(net, 'createServer').and.callThrough();
      const argv = ['npx', 'maestro', 'test', 'flow.yaml'];
      const ctx = ctxFor(argv);
      await maybeInjectDriverHostPort(ctx);
      expect(created).not.toHaveBeenCalled();
      expect(ctx.argv).toEqual(argv);
    });

    it('skips when args has fewer than two elements', async () => {
      const created = spyOn(net, 'createServer').and.callThrough();
      const argv = ['maestro'];
      const ctx = ctxFor(argv);
      await maybeInjectDriverHostPort(ctx);
      expect(created).not.toHaveBeenCalled();
      expect(ctx.argv).toEqual(argv);
    });

    it('matches by basename when the command is an absolute path', async () => {
      stubNetWithPort(50500);
      const ctx = ctxFor(['/Users/foo/.maestro/bin/maestro', 'test', 'flow.yaml']);
      await maybeInjectDriverHostPort(ctx);
      expect(process.env.PERCY_IOS_DRIVER_HOST_PORT).toBe('50500');
      expect(ctx.argv).toEqual([
        '/Users/foo/.maestro/bin/maestro', 'test',
        '--driver-host-port', '50500',
        'flow.yaml'
      ]);
    });

    it('splices at index 2 alongside sibling injections from --test-output-dir / -e PERCY_SERVER', async () => {
      // Simulate post-state of sibling helpers having already injected
      // their flags. New flag should land between `test` and them.
      stubNetWithPort(55555);
      const ctx = ctxFor([
        'maestro', 'test',
        '--test-output-dir', '/some/dir',
        '-e', 'PERCY_SERVER=http://localhost:5338',
        'flow.yaml'
      ]);
      await maybeInjectDriverHostPort(ctx);
      expect(ctx.argv).toEqual([
        'maestro', 'test',
        '--driver-host-port', '55555',
        '--test-output-dir', '/some/dir',
        '-e', 'PERCY_SERVER=http://localhost:5338',
        'flow.yaml'
      ]);
    });
  });
});
