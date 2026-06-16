import fs from 'fs';
import os from 'os';
import path from 'path';
import { setupTest } from '@percy/cli-command/test/helpers';
import * as ExecPlugin from '@percy/cli-exec';
import {
  exec, start, stop, ping,
  maybeInjectMaestroServer, maybeInjectScreenshotDir
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

    // Maestro accepts global flags BEFORE the `test` subcommand
    // (picocli convention): `maestro --udid X test flow.yaml`,
    // `maestro --platform=android test flow.yaml`, etc. The injection
    // must locate `test` and splice the -e pair right after it, not
    // assume args[1] === 'test'.
    it('injects after `test` when --udid <value> precedes the subcommand', () => {
      const ctx = ctxFor(['maestro', '--udid', '61031VDCR0004B', 'test', 'flow.yaml']);
      maybeInjectMaestroServer(ctx);
      expect(ctx.argv).toEqual([
        'maestro', '--udid', '61031VDCR0004B', 'test',
        '-e', 'PERCY_SERVER=http://localhost:5338',
        'flow.yaml'
      ]);
    });

    it('injects after `test` when --device <value> precedes the subcommand', () => {
      const ctx = ctxFor(['maestro', '--device', 'Pixel-10', 'test', 'flow.yaml']);
      maybeInjectMaestroServer(ctx);
      expect(ctx.argv).toEqual([
        'maestro', '--device', 'Pixel-10', 'test',
        '-e', 'PERCY_SERVER=http://localhost:5338',
        'flow.yaml'
      ]);
    });

    it('injects after `test` when --platform=android (= form) precedes the subcommand', () => {
      const ctx = ctxFor(['maestro', '--platform=android', 'test', 'flow.yaml']);
      maybeInjectMaestroServer(ctx);
      expect(ctx.argv).toEqual([
        'maestro', '--platform=android', 'test',
        '-e', 'PERCY_SERVER=http://localhost:5338',
        'flow.yaml'
      ]);
    });

    it('injects after `test` when multiple parent flags precede the subcommand', () => {
      const ctx = ctxFor([
        'maestro', '--udid', '61031VDCR0004B', '--platform', 'android',
        'test', 'flow.yaml'
      ]);
      maybeInjectMaestroServer(ctx);
      expect(ctx.argv).toEqual([
        'maestro', '--udid', '61031VDCR0004B', '--platform', 'android', 'test',
        '-e', 'PERCY_SERVER=http://localhost:5338',
        'flow.yaml'
      ]);
    });

    it('detects deeper -e PERCY_SERVER override when global flags precede `test`', () => {
      const argv = [
        'maestro', '--udid', '61031VDCR0004B', 'test',
        '-e', 'PERCY_SERVER=http://custom:9999', 'flow.yaml'
      ];
      const ctx = ctxFor(argv);
      maybeInjectMaestroServer(ctx);
      expect(ctx.argv).toEqual(argv);
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

    // Mirror the maestro-server tests: `test` may follow global parent
    // flags (--udid, --device, --platform, ...), so the helper must
    // locate `test` and splice --test-output-dir right after it.
    it('injects --test-output-dir after `test` when --udid <value> precedes the subcommand', () => {
      const mkdir = spyOn(fs, 'mkdirSync').and.callFake(() => {});
      const expectedDir = path.join(process.cwd(), '.percy-out');
      const ctx = ctxFor(['maestro', '--udid', '61031VDCR0004B', 'test', 'flow.yaml']);
      maybeInjectScreenshotDir(ctx);
      expect(mkdir).toHaveBeenCalledWith(expectedDir, { recursive: true });
      expect(ctx.argv).toEqual([
        'maestro', '--udid', '61031VDCR0004B', 'test',
        '--test-output-dir', expectedDir,
        'flow.yaml'
      ]);
    });

    it('injects --test-output-dir after `test` when --platform=android precedes the subcommand', () => {
      const mkdir = spyOn(fs, 'mkdirSync').and.callFake(() => {});
      const expectedDir = path.join(process.cwd(), '.percy-out');
      const ctx = ctxFor(['maestro', '--platform=android', 'test', 'flow.yaml']);
      maybeInjectScreenshotDir(ctx);
      expect(mkdir).toHaveBeenCalledWith(expectedDir, { recursive: true });
      expect(ctx.argv).toEqual([
        'maestro', '--platform=android', 'test',
        '--test-output-dir', expectedDir,
        'flow.yaml'
      ]);
    });

    it('detects deeper customer --test-output-dir when global flags precede `test`', () => {
      const mkdir = spyOn(fs, 'mkdirSync').and.callFake(() => {});
      const ctx = ctxFor([
        'maestro', '--udid', '61031VDCR0004B', 'test',
        '--test-output-dir', '/custom/path', 'flow.yaml'
      ]);
      maybeInjectScreenshotDir(ctx);
      expect(mkdir).not.toHaveBeenCalled();
      expect(process.env.PERCY_MAESTRO_SCREENSHOT_DIR).toBe('/custom/path');
      expect(ctx.argv).toEqual([
        'maestro', '--udid', '61031VDCR0004B', 'test',
        '--test-output-dir', '/custom/path', 'flow.yaml'
      ]);
    });
  });
});
