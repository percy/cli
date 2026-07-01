import fs from 'fs';
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

    // --test-output-dir=<value> is valid picocli syntax (single token, `=`).
    // Without equals-form handling, the helper would think no flag is set,
    // inject a SECOND --test-output-dir, and overwrite PERCY_MAESTRO_SCREENSHOT_DIR
    // to the auto-resolved .percy-out — Maestro then writes screenshots to one
    // dir while the relay reads from another → silent all-404 snapshots.
    it('honors customer-supplied --test-output-dir=<value> equals-form', () => {
      const mkdir = spyOn(fs, 'mkdirSync').and.callFake(() => {});
      const ctx = ctxFor(['maestro', 'test', '--test-output-dir=/custom/eq', 'flow.yaml']);
      maybeInjectScreenshotDir(ctx);
      expect(mkdir).not.toHaveBeenCalled();
      expect(process.env.PERCY_MAESTRO_SCREENSHOT_DIR).toBe('/custom/eq');
      // argv unchanged — no duplicate --test-output-dir injection
      expect(ctx.argv).toEqual([
        'maestro', 'test', '--test-output-dir=/custom/eq', 'flow.yaml'
      ]);
    });

    it('honors --test-output-dir=<value> when global flags precede `test`', () => {
      const mkdir = spyOn(fs, 'mkdirSync').and.callFake(() => {});
      const ctx = ctxFor([
        'maestro', '--udid', '61031VDCR0004B', 'test',
        '--test-output-dir=/custom/eq', 'flow.yaml'
      ]);
      maybeInjectScreenshotDir(ctx);
      expect(mkdir).not.toHaveBeenCalled();
      expect(process.env.PERCY_MAESTRO_SCREENSHOT_DIR).toBe('/custom/eq');
      expect(ctx.argv).toEqual([
        'maestro', '--udid', '61031VDCR0004B', 'test',
        '--test-output-dir=/custom/eq', 'flow.yaml'
      ]);
    });

    it('treats env var as override when both env and --test-output-dir=<value> equals-form are set', () => {
      process.env.PERCY_MAESTRO_SCREENSHOT_DIR = '/from/env';
      const mkdir = spyOn(fs, 'mkdirSync').and.callFake(() => {});
      const argv = ['maestro', 'test', '--test-output-dir=/from/eq', 'flow.yaml'];
      const ctx = ctxFor(argv);
      maybeInjectScreenshotDir(ctx);
      expect(mkdir).not.toHaveBeenCalled();
      // env wins on read; argv untouched (both customer-set → fully passive)
      expect(process.env.PERCY_MAESTRO_SCREENSHOT_DIR).toBe('/from/env');
      expect(ctx.argv).toEqual(argv);
    });

    // An empty equals-form value `--test-output-dir=` (and the space-form
    // equivalent `--test-output-dir ''`) is a user error / typo. Without
    // the empty-string guard the helper would treat the empty string as a
    // customer-set value, leaving PERCY_MAESTRO_SCREENSHOT_DIR unset AND
    // skipping the auto-resolve fallback — Maestro defaults its own output
    // dir while the SDK reads an empty env var. Producing all-404 snapshots
    // silently. The helper instead falls through to the auto-resolve path
    // as if the flag were absent.
    it('treats empty --test-output-dir= equals-form value as absent (falls through to auto-resolve)', () => {
      const mkdir = spyOn(fs, 'mkdirSync').and.callFake(() => {});
      const expectedDir = path.join(process.cwd(), '.percy-out');
      const ctx = ctxFor(['maestro', 'test', '--test-output-dir=', 'flow.yaml']);
      maybeInjectScreenshotDir(ctx);
      expect(mkdir).toHaveBeenCalledWith(expectedDir, { recursive: true });
      expect(process.env.PERCY_MAESTRO_SCREENSHOT_DIR).toBe(expectedDir);
      // argv: original empty --test-output-dir= preserved AND the resolved
      // value spliced in (Maestro picocli will accept the latter override).
      expect(ctx.argv).toEqual([
        'maestro', 'test', '--test-output-dir', expectedDir,
        '--test-output-dir=', 'flow.yaml'
      ]);
    });

    it('treats empty space-form --test-output-dir "" as absent (falls through to auto-resolve)', () => {
      const mkdir = spyOn(fs, 'mkdirSync').and.callFake(() => {});
      const expectedDir = path.join(process.cwd(), '.percy-out');
      const ctx = ctxFor(['maestro', 'test', '--test-output-dir', '', 'flow.yaml']);
      maybeInjectScreenshotDir(ctx);
      expect(mkdir).toHaveBeenCalledWith(expectedDir, { recursive: true });
      expect(process.env.PERCY_MAESTRO_SCREENSHOT_DIR).toBe(expectedDir);
      expect(ctx.argv).toEqual([
        'maestro', 'test', '--test-output-dir', expectedDir,
        '--test-output-dir', '', 'flow.yaml'
      ]);
    });
  });

  describe('maybeInjectDriverHostPort', () => {
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

    // Fake `maestro --version` result at the requested version.
    function versionDeps(version, port = 9555) {
      return {
        execMaestro: () => ({ stdout: `${version}\n`, stderr: '', status: 0 }),
        pickFreePort: () => port
      };
    }

    it('injects --driver-host-port after test and mirrors env on Maestro 2.6.1 + --platform=ios', async () => {
      const log = { info: jasmine.createSpy('info'), debug: jasmine.createSpy('debug') };
      const ctx = ctxFor(['maestro', '--platform=ios', 'test', 'flow.yaml']);
      await maybeInjectDriverHostPort(ctx, log, versionDeps('2.6.1'));
      expect(ctx.argv).toEqual([
        'maestro', '--platform=ios', 'test', '--driver-host-port', '9555', 'flow.yaml'
      ]);
      expect(process.env.PERCY_IOS_DRIVER_HOST_PORT).toBe('9555');
      expect(log.info).toHaveBeenCalledTimes(1);
    });

    it('injects at the 2.6.0 boundary', async () => {
      const ctx = ctxFor(['maestro', '--platform=ios', 'test', 'flow.yaml']);
      await maybeInjectDriverHostPort(ctx, null, versionDeps('2.6.0'));
      expect(ctx.argv).toContain('--driver-host-port');
      expect(process.env.PERCY_IOS_DRIVER_HOST_PORT).toBe('9555');
    });

    it('detects --platform ios space-form', async () => {
      const ctx = ctxFor(['maestro', '--platform', 'ios', 'test', 'flow.yaml']);
      await maybeInjectDriverHostPort(ctx, null, versionDeps('2.6.1'));
      expect(ctx.argv).toEqual([
        'maestro', '--platform', 'ios', 'test', '--driver-host-port', '9555', 'flow.yaml'
      ]);
    });

    it('detects the -p ios alias', async () => {
      const ctx = ctxFor(['maestro', '-p', 'ios', 'test', 'flow.yaml']);
      await maybeInjectDriverHostPort(ctx, null, versionDeps('2.6.1'));
      expect(ctx.argv).toContain('--driver-host-port');
    });

    it('no-ops for --platform=android', async () => {
      const argv = ['maestro', '--platform=android', 'test', 'flow.yaml'];
      const ctx = ctxFor(argv);
      await maybeInjectDriverHostPort(ctx, null, versionDeps('2.6.1'));
      expect(ctx.argv).toEqual(argv);
      expect(process.env.PERCY_IOS_DRIVER_HOST_PORT).toBeUndefined();
    });

    it('no-ops when no --platform is given (conservative gate)', async () => {
      const argv = ['maestro', 'test', 'flow.yaml'];
      const ctx = ctxFor(argv);
      await maybeInjectDriverHostPort(ctx, null, versionDeps('2.6.1'));
      expect(ctx.argv).toEqual(argv);
    });

    it('no-ops on Maestro 2.4.0 (flag would be a fatal Unknown option)', async () => {
      const log = { debug: jasmine.createSpy('debug') };
      const argv = ['maestro', '--platform=ios', 'test', 'flow.yaml'];
      const ctx = ctxFor(argv);
      await maybeInjectDriverHostPort(ctx, log, versionDeps('2.4.0'));
      expect(ctx.argv).toEqual(argv);
      expect(process.env.PERCY_IOS_DRIVER_HOST_PORT).toBeUndefined();
      expect(log.debug).toHaveBeenCalled();
    });

    it('no-ops on legacy Maestro 1.40.0', async () => {
      const argv = ['maestro', '--platform=ios', 'test', 'flow.yaml'];
      const ctx = ctxFor(argv);
      await maybeInjectDriverHostPort(ctx, null, versionDeps('1.40.0'));
      expect(ctx.argv).toEqual(argv);
    });

    it('injects on a future major (Maestro 3.0.0, forward-compat)', async () => {
      const ctx = ctxFor(['maestro', '--platform=ios', 'test', 'flow.yaml']);
      await maybeInjectDriverHostPort(ctx, null, versionDeps('3.0.0'));
      expect(ctx.argv).toContain('--driver-host-port');
    });

    it('no-ops for --platform android space-form (non-ios)', async () => {
      const argv = ['maestro', '--platform', 'android', 'test', 'flow.yaml'];
      const ctx = ctxFor(argv);
      await maybeInjectDriverHostPort(ctx, null, versionDeps('2.6.1'));
      expect(ctx.argv).toEqual(argv);
    });

    it('treats an empty space-form --driver-host-port "" as absent and picks fresh', async () => {
      const ctx = ctxFor(['maestro', '--platform=ios', 'test', '--driver-host-port', '', 'flow.yaml']);
      await maybeInjectDriverHostPort(ctx, null, versionDeps('2.6.1'));
      // customer's empty flag is left in place; our own pinned flag is spliced after test
      expect(ctx.argv).toEqual([
        'maestro', '--platform=ios', 'test', '--driver-host-port', '9555', '--driver-host-port', '', 'flow.yaml'
      ]);
      expect(process.env.PERCY_IOS_DRIVER_HOST_PORT).toBe('9555');
    });

    it('treats a trailing --driver-host-port with no value as absent and picks fresh', async () => {
      const ctx = ctxFor(['maestro', '--platform=ios', 'test', 'flow.yaml', '--driver-host-port']);
      await maybeInjectDriverHostPort(ctx, null, versionDeps('2.6.1'));
      expect(ctx.argv).toContain('9555');
      expect(process.env.PERCY_IOS_DRIVER_HOST_PORT).toBe('9555');
    });

    it('no-ops (debug) when execMaestro returns nothing', async () => {
      const log = { debug: jasmine.createSpy('debug') };
      const argv = ['maestro', '--platform=ios', 'test', 'flow.yaml'];
      const ctx = ctxFor(argv);
      await maybeInjectDriverHostPort(ctx, log, {
        execMaestro: () => undefined,
        pickFreePort: () => 9555
      });
      expect(ctx.argv).toEqual(argv);
      expect(log.debug).toHaveBeenCalled();
    });

    it('stays fully passive when the customer pinned --driver-host-port (space-form)', async () => {
      const argv = ['maestro', '--platform=ios', 'test', '--driver-host-port', '7777', 'flow.yaml'];
      const ctx = ctxFor(argv);
      await maybeInjectDriverHostPort(ctx, null, versionDeps('2.6.1'));
      expect(ctx.argv).toEqual(argv);
      expect(process.env.PERCY_IOS_DRIVER_HOST_PORT).toBeUndefined();
    });

    it('stays fully passive when the customer pinned --driver-host-port= (equals-form)', async () => {
      const argv = ['maestro', '--platform=ios', 'test', '--driver-host-port=7777', 'flow.yaml'];
      const ctx = ctxFor(argv);
      await maybeInjectDriverHostPort(ctx, null, versionDeps('2.6.1'));
      expect(ctx.argv).toEqual(argv);
    });

    it('reuses a valid customer PERCY_IOS_DRIVER_HOST_PORT env value and still splices argv', async () => {
      process.env.PERCY_IOS_DRIVER_HOST_PORT = '8888';
      const ctx = ctxFor(['maestro', '--platform=ios', 'test', 'flow.yaml']);
      await maybeInjectDriverHostPort(ctx, null, versionDeps('2.6.1', 9555));
      expect(ctx.argv).toEqual([
        'maestro', '--platform=ios', 'test', '--driver-host-port', '8888', 'flow.yaml'
      ]);
      expect(process.env.PERCY_IOS_DRIVER_HOST_PORT).toBe('8888');
    });

    it('stays passive when BOTH customer argv flag and env are set', async () => {
      process.env.PERCY_IOS_DRIVER_HOST_PORT = '8888';
      const argv = ['maestro', '--platform=ios', 'test', '--driver-host-port', '7777', 'flow.yaml'];
      const ctx = ctxFor(argv);
      await maybeInjectDriverHostPort(ctx, null, versionDeps('2.6.1'));
      expect(ctx.argv).toEqual(argv);
      expect(process.env.PERCY_IOS_DRIVER_HOST_PORT).toBe('8888');
    });

    it('injects past a parent flag (--udid X test --platform=ios)', async () => {
      const ctx = ctxFor(['maestro', '--udid', 'X', 'test', '--platform=ios', 'flow.yaml']);
      await maybeInjectDriverHostPort(ctx, null, versionDeps('2.6.1'));
      expect(ctx.argv).toEqual([
        'maestro', '--udid', 'X', 'test', '--driver-host-port', '9555', '--platform=ios', 'flow.yaml'
      ]);
    });

    it('no-ops (debug) when execMaestro throws ENOENT', async () => {
      const log = { debug: jasmine.createSpy('debug') };
      const argv = ['maestro', '--platform=ios', 'test', 'flow.yaml'];
      const ctx = ctxFor(argv);
      await maybeInjectDriverHostPort(ctx, log, {
        execMaestro: () => { const e = new Error('ENOENT'); e.code = 'ENOENT'; throw e; },
        pickFreePort: () => 9555
      });
      expect(ctx.argv).toEqual(argv);
      expect(log.debug).toHaveBeenCalled();
    });

    it('no-ops (debug) when execMaestro returns a non-zero status', async () => {
      const log = { debug: jasmine.createSpy('debug') };
      const argv = ['maestro', '--platform=ios', 'test', 'flow.yaml'];
      const ctx = ctxFor(argv);
      await maybeInjectDriverHostPort(ctx, log, {
        execMaestro: () => ({ stdout: '', stderr: 'boom', status: 1 }),
        pickFreePort: () => 9555
      });
      expect(ctx.argv).toEqual(argv);
      expect(log.debug).toHaveBeenCalled();
    });

    it('no-ops (debug) when execMaestro returns an error object (ENOENT, no throw)', async () => {
      const log = { debug: jasmine.createSpy('debug') };
      const argv = ['maestro', '--platform=ios', 'test', 'flow.yaml'];
      const ctx = ctxFor(argv);
      await maybeInjectDriverHostPort(ctx, log, {
        execMaestro: () => ({ error: new Error('spawn ENOENT'), status: null }),
        pickFreePort: () => 9555
      });
      expect(ctx.argv).toEqual(argv);
      expect(log.debug).toHaveBeenCalled();
    });

    it('no-ops (debug) when version output is unparseable', async () => {
      const log = { debug: jasmine.createSpy('debug') };
      const argv = ['maestro', '--platform=ios', 'test', 'flow.yaml'];
      const ctx = ctxFor(argv);
      await maybeInjectDriverHostPort(ctx, log, {
        execMaestro: () => ({ stdout: 'no version here', stderr: '', status: 0 }),
        pickFreePort: () => 9555
      });
      expect(ctx.argv).toEqual(argv);
      expect(log.debug).toHaveBeenCalled();
    });

    it('parses a version emitted on stderr', async () => {
      const ctx = ctxFor(['maestro', '--platform=ios', 'test', 'flow.yaml']);
      await maybeInjectDriverHostPort(ctx, null, {
        execMaestro: () => ({ stdout: '', stderr: '2.6.3', status: 0 }),
        pickFreePort: () => 9555
      });
      expect(ctx.argv).toContain('--driver-host-port');
    });

    it('no-ops for `maestro hierarchy` (not a test command)', async () => {
      const argv = ['maestro', 'hierarchy', '--udid', 'X'];
      const ctx = ctxFor(argv);
      await maybeInjectDriverHostPort(ctx, null, versionDeps('2.6.1'));
      expect(ctx.argv).toEqual(argv);
    });

    it('no-ops for `npx maestro test` (argv[0] is npx, not maestro)', async () => {
      const argv = ['npx', 'maestro', 'test', '--platform=ios', 'flow.yaml'];
      const ctx = ctxFor(argv);
      await maybeInjectDriverHostPort(ctx, null, versionDeps('2.6.1'));
      expect(ctx.argv).toEqual(argv);
    });

    it('no-ops when args has fewer than two elements', async () => {
      const argv = ['maestro'];
      const ctx = ctxFor(argv);
      await maybeInjectDriverHostPort(ctx, null, versionDeps('2.6.1'));
      expect(ctx.argv).toEqual(argv);
    });

    it('matches by basename when the command is an absolute path', async () => {
      const ctx = ctxFor(['/Users/foo/.maestro/bin/maestro', '--platform=ios', 'test', 'flow.yaml']);
      await maybeInjectDriverHostPort(ctx, null, versionDeps('2.6.1'));
      expect(ctx.argv).toContain('--driver-host-port');
    });

    it('treats an empty equals-form --driver-host-port= as absent and picks fresh', async () => {
      const ctx = ctxFor(['maestro', '--platform=ios', 'test', '--driver-host-port=', 'flow.yaml']);
      await maybeInjectDriverHostPort(ctx, null, versionDeps('2.6.1'));
      expect(ctx.argv).toEqual([
        'maestro', '--platform=ios', 'test', '--driver-host-port', '9555', '--driver-host-port=', 'flow.yaml'
      ]);
      expect(process.env.PERCY_IOS_DRIVER_HOST_PORT).toBe('9555');
    });

    it('treats a non-numeric env value as absent and picks fresh', async () => {
      process.env.PERCY_IOS_DRIVER_HOST_PORT = 'not-a-port';
      const ctx = ctxFor(['maestro', '--platform=ios', 'test', 'flow.yaml']);
      await maybeInjectDriverHostPort(ctx, null, versionDeps('2.6.1', 9555));
      expect(process.env.PERCY_IOS_DRIVER_HOST_PORT).toBe('9555');
    });

    it('treats an out-of-range env value as absent and picks fresh', async () => {
      process.env.PERCY_IOS_DRIVER_HOST_PORT = '70000';
      const ctx = ctxFor(['maestro', '--platform=ios', 'test', 'flow.yaml']);
      await maybeInjectDriverHostPort(ctx, null, versionDeps('2.6.1', 9556));
      expect(process.env.PERCY_IOS_DRIVER_HOST_PORT).toBe('9556');
    });

    it('gives concurrent invocations distinct ports', async () => {
      // Real concurrent app:exec runs are separate processes with separate
      // process.env; clear the env between calls to model that (otherwise the
      // first call's env mirror is reused by the second — itself correct, but a
      // different property than the picker producing distinct ports).
      const picker = jasmine.createSpy('pickFreePort').and.returnValues(9555, 9556);
      const deps = { execMaestro: () => ({ stdout: '2.6.1', stderr: '', status: 0 }), pickFreePort: picker };
      const a = ctxFor(['maestro', '--platform=ios', 'test', 'a.yaml']);
      const b = ctxFor(['maestro', '--platform=ios', 'test', 'b.yaml']);
      await maybeInjectDriverHostPort(a, null, deps);
      delete process.env.PERCY_IOS_DRIVER_HOST_PORT;
      await maybeInjectDriverHostPort(b, null, deps);
      expect(a.argv).toContain('9555');
      expect(b.argv).toContain('9556');
    });

    it('no-ops on sharded runs (--shards), leaving the port to the relay probe', async () => {
      const argv = ['maestro', '--platform=ios', 'test', '--shards', '2', 'flow.yaml'];
      const ctx = ctxFor(argv);
      await maybeInjectDriverHostPort(ctx, null, versionDeps('2.6.1'));
      expect(ctx.argv).toEqual(argv);
      expect(process.env.PERCY_IOS_DRIVER_HOST_PORT).toBeUndefined();
    });

    it('no-ops on sharded runs (equals-form --shards=2 and other shard flags)', async () => {
      for (const shardFlag of [['--shards=2'], ['--shard-split', '2'], ['--shard-all'], ['-s', '2']]) {
        const argv = ['maestro', '--platform=ios', 'test', ...shardFlag, 'flow.yaml'];
        const ctx = ctxFor(argv);
        await maybeInjectDriverHostPort(ctx, null, versionDeps('2.6.1'));
        expect(ctx.argv).toEqual(argv);
      }
    });

    it('no-ops for non-maestro commands', async () => {
      const argv = ['python', 'test.py'];
      const ctx = ctxFor(argv);
      await maybeInjectDriverHostPort(ctx, null, versionDeps('2.6.1'));
      expect(ctx.argv).toEqual(argv);
    });

    it('tolerates a missing ctx / argv', async () => {
      await maybeInjectDriverHostPort(undefined, null, versionDeps('2.6.1'));
      await maybeInjectDriverHostPort({}, null, versionDeps('2.6.1'));
      // no throw
      expect(true).toBe(true);
    });
  });
});
