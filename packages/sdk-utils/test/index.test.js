import helpers from './helpers.js';
import utils from '@percy/sdk-utils';

describe('SDK Utils', () => {
  beforeEach(async () => {
    await helpers.setupTest();
  });

  describe('percy', () => {
    let { percy } = utils;

    it('contains the server address as defined by PERCY_SERVER_ADDRESS', () => {
      expect(percy.address).toEqual('http://localhost:5338');
      process.env.PERCY_SERVER_ADDRESS = 'http://localhost:1234';
      expect(percy.address).toEqual('http://localhost:1234');
    });

    it('sets PERCY_SERVER_ADDRESS when setting percy.address', () => {
      expect(percy.address).toEqual('http://localhost:5338');
      percy.address = 'http://localhost:4567';
      expect(percy.address).toEqual('http://localhost:4567');
      expect(process.env.PERCY_SERVER_ADDRESS).toEqual('http://localhost:4567');
    });

    it('contains placeholder percy server version information', () => {
      expect(percy.version.toString()).toEqual('0.0.0');
      expect(percy.version).toHaveProperty('major', 0);
      expect(percy.version).toHaveProperty('minor', 0);
      expect(percy.version).toHaveProperty('patch', 0);
      expect(percy.version).not.toHaveProperty('prerelease');
      expect(percy.version).not.toHaveProperty('build');
    });

    describe('after calling isPercyEnabled()', () => {
      let { isPercyEnabled } = utils;

      beforeEach(async () => {
        await helpers.test('version', '1.2.3-beta.4');
        await helpers.test('build-created');
        await expectAsync(isPercyEnabled()).toBeResolvedTo(true);
      });

      it('contains updated percy server version information', () => {
        expect(percy.version.toString()).toEqual('1.2.3-beta.4');
        expect(percy.version).toHaveProperty('major', 1);
        expect(percy.version).toHaveProperty('minor', 2);
        expect(percy.version).toHaveProperty('patch', 3);
        expect(percy.version).toHaveProperty('prerelease', 'beta');
        expect(percy.version).toHaveProperty('build', 4);
      });

      it('contains percy config', () => {
        expect(percy).toHaveProperty('config.snapshot.widths', [375, 1280]);
      });

      it('contains type', () => {
        expect(percy.type).toEqual('web');
      });

      it('contains percy build info', () => {
        expect(percy.build).toHaveProperty('id', '123');
        expect(percy.build).toHaveProperty('url', 'https://percy.io/test/test/123');
      });

      it('contains percy width', () => {
        expect(percy.widths).toHaveProperty('config', [375, 1280]);
        expect(percy.widths).toHaveProperty('mobile', []);
      });

      it('contains percy deviceDetails', () => {
        expect(percy.deviceDetails).toEqual([]);
      });
    });
  });

  describe('isPercyEnabled()', () => {
    let { isPercyEnabled } = utils;

    it('calls the healthcheck endpoint and caches the result', async () => {
      await expectAsync(isPercyEnabled()).toBeResolvedTo(true);
      await expectAsync(isPercyEnabled()).toBeResolvedTo(true);
      await expectAsync(isPercyEnabled()).toBeResolvedTo(true);

      // no matter how many calls, we should only have one healthcheck request
      await expectAsync(helpers.get('requests', r => r.url))
        .toBeResolvedTo(['/percy/healthcheck']);
    });

    it('disables snapshots when the healthcheck fails', async () => {
      await helpers.test('error', '/percy/healthcheck');
      await expectAsync(isPercyEnabled()).toBeResolvedTo(false);

      expect(helpers.logger.stdout).toEqual(jasmine.arrayContaining([
        '[percy] Percy is not running, disabling snapshots'
      ]));
    });

    it('disables snapshots when the request errors', async () => {
      await helpers.test('disconnect', '/percy/healthcheck');
      await expectAsync(isPercyEnabled()).toBeResolvedTo(false);

      expect(helpers.logger.stdout).toEqual(jasmine.arrayContaining([
        '[percy] Percy is not running, disabling snapshots'
      ]));
    });

    it('disables snapshots when the API version is unsupported', async () => {
      await helpers.test('version', '0.1.0');
      await expectAsync(isPercyEnabled()).toBeResolvedTo(false);

      expect(helpers.logger.stdout).toEqual(jasmine.arrayContaining([
        '[percy] Unsupported Percy CLI version, disabling snapshots'
      ]));
    });

    it('returns false if the build fails during a snapshot', async () => {
      await helpers.test('error', '/percy/snapshot');
      await helpers.test('build-failure');

      await expectAsync(isPercyEnabled()).toBeResolvedTo(true);
      await expectAsync(utils.postSnapshot({})).toBeResolved();
      await expectAsync(isPercyEnabled()).toBeResolvedTo(false);
    });

    it('stores deviceDetails when populated', async () => {
      // Set up deviceDetails via test config
      await helpers.test('config', { mobile: [390, 456] });

      // Reset and refetch healthcheck data
      utils.percy.enabled = null;
      await expectAsync(isPercyEnabled()).toBeResolvedTo(true);

      expect(utils.percy.deviceDetails).toEqual([
        { width: 390 },
        { width: 456 }
      ]);

      // Cleanup: reset deviceDetails back to empty
      await helpers.test('config', { config: [375, 1280] });
      utils.percy.enabled = null;
      utils.percy.deviceDetails = undefined;
    });
  });

  describe('waitForPercyIdle()', () => {
    let { waitForPercyIdle } = utils;

    it('gets idle state from the CLI API idle endpoint', async () => {
      await expectAsync(waitForPercyIdle()).toBeResolvedTo(true);
      await expectAsync(helpers.get('requests', r => r.url))
        .toBeResolvedTo(['/percy/idle']);
    });

    it('polls the CLI API idle endpoint on timeout', async () => {
      spyOn(utils.request, 'fetch').and.callFake((...args) => {
        return utils.request.fetch.calls.count() > 2
          ? utils.request.fetch.and.originalFn(...args)
        // eslint-disable-next-line prefer-promise-reject-errors
          : Promise.reject({ code: 'ETIMEDOUT' });
      });

      await expectAsync(waitForPercyIdle()).toBeResolvedTo(true);
      expect(utils.request.fetch).toHaveBeenCalledTimes(3);
    });
  });

  describe('fetchPercyDOM()', () => {
    let { fetchPercyDOM } = utils;

    it('fetches @percy/dom from the CLI API and caches the result', async () => {
      let domScript = jasmine.stringMatching(/\b(PercyDOM)\b/);
      await expectAsync(fetchPercyDOM()).toBeResolvedTo(domScript);
      await expectAsync(fetchPercyDOM()).toBeResolvedTo(domScript);
      await expectAsync(helpers.get('requests', r => r.url))
        .toBeResolvedTo(['/percy/dom.js']);
    });
  });

  describe('postSnapshot(options[, params])', () => {
    let { postSnapshot } = utils;
    let options;

    beforeEach(() => {
      options = {
        name: 'Snapshot Name',
        url: 'http://localhost:8000/',
        domSnapshot: '<SERIALIZED_DOM>',
        clientInfo: 'sdk/version',
        environmentInfo: ['lib/version', 'lang/version'],
        enableJavaScript: true
      };
    });

    it('posts snapshot options to the CLI API snapshot endpoint', async () => {
      await expectAsync(postSnapshot(options)).toBeResolvedTo(jasmine.objectContaining({ body: { success: true } }));
      await expectAsync(helpers.get('requests')).toBeResolvedTo([{
        url: '/percy/snapshot',
        method: 'POST',
        body: options
      }]);
    });

    it('throws when the snapshot API fails', async () => {
      await helpers.test('error', '/percy/snapshot');

      await expectAsync(postSnapshot({}))
        .toBeRejectedWithError('testing');
    });

    it('disables snapshots when a build fails', async () => {
      await helpers.test('error', '/percy/snapshot');
      await helpers.test('build-failure');
      utils.percy.enabled = true;

      expect(utils.percy.enabled).toEqual(true);
      await expectAsync(postSnapshot({})).toBeResolved();
      expect(utils.percy.enabled).toEqual(false);
    });

    it('accepts URL parameters as the second argument', async () => {
      let params = { test: 'foobar' };

      await expectAsync(postSnapshot(options, params)).toBeResolved();
      await expectAsync(helpers.get('requests')).toBeResolvedTo([{
        url: `/percy/snapshot?${new URLSearchParams(params)}`,
        method: 'POST',
        body: options
      }]);
    });
  });

  describe('captureAutomateScreenshot(options[, params])', () => {
    let { captureAutomateScreenshot } = utils;
    let options;

    beforeEach(() => {
      options = {
        snapshotName: 'Snapshot Name',
        commandExecutorUrl: 'http://localhost:8000/',
        capabilities: '<SERIALIZED_capabilities>',
        sessionCapabilites: '<SERIALIZED_capabilities>',
        clientInfo: 'sdk/version',
        environmentInfo: ['lib/version', 'lang/version'],
        sessionId: '123'
      };
      spyOn(utils.request, 'post').and.callFake(() => Promise.resolve(true));
    });

    it('posts screenshot options to the CLI API snapshot endpoint', async () => {
      await captureAutomateScreenshot(options);
      expect(utils.request.post).toHaveBeenCalledWith('/percy/automateScreenshot', options);
    });

    it('posts screenshot options to the CLI API snapshot endpoint and return data', async () => {
      spyOn(utils.request, 'post').and.callFake(() => Promise.resolve({ data: 'sync-data' }));
      const response = await captureAutomateScreenshot(options);
      expect(response).toEqual({ data: 'sync-data' });
      expect(utils.request.post).toHaveBeenCalledWith('/percy/automateScreenshot', options);
    });

    it('throws when the screenshot API fails', async () => {
      spyOn(utils.request, 'post').and.callFake(() => Promise.reject(new Error('testing')));
      await expectAsync(captureAutomateScreenshot({}))
        .toBeRejectedWithError('testing');
    });

    it('disables screenshots when a build fails', async () => {
      // eslint-disable-next-line prefer-promise-reject-errors
      spyOn(utils.request, 'post').and.callFake(() => Promise.reject({ response: { body: { build: { error: true } } } }));

      utils.percy.enabled = true;
      expect(utils.percy.enabled).toEqual(true);
      await captureAutomateScreenshot({});
      expect(utils.percy.enabled).toEqual(false);
    });

    it('accepts URL parameters as the second argument', async () => {
      let params = { test: 'foobar' };

      await expectAsync(captureAutomateScreenshot(options, params)).toBeResolved();
      expect(utils.request.post).toHaveBeenCalledWith(`/percy/automateScreenshot?${new URLSearchParams(params)}`, options);
    });
  });

  describe('postComparison(options[, params])', () => {
    let { postComparison } = utils;
    let options;

    beforeEach(() => {
      options = {
        name: 'Snapshot Name',
        tag: { name: 'Tag Name' },
        tiles: [{ filename: '/foo/bar' }],
        externalDebugUrl: 'http://external-debug-url'
      };
    });

    it('posts comparison options to the CLI API comparison endpoint', async () => {
      await expectAsync(postComparison(options)).toBeResolved();
      await expectAsync(helpers.get('requests')).toBeResolvedTo([{
        url: '/percy/comparison',
        method: 'POST',
        body: options
      }]);
    });

    it('throws when the comparison API fails', async () => {
      await helpers.test('error', '/percy/comparison');

      await expectAsync(postComparison({}))
        .toBeRejectedWithError('testing');
    });

    it('disables snapshots when a build fails', async () => {
      await helpers.test('error', '/percy/comparison');
      await helpers.test('build-failure');
      utils.percy.enabled = true;

      expect(utils.percy.enabled).toEqual(true);
      await expectAsync(postComparison({})).toBeResolved();
      expect(utils.percy.enabled).toEqual(false);
    });

    it('accepts URL parameters as the second argument', async () => {
      let params = { test: 'foobar' };

      await expectAsync(postComparison(options, params)).toBeResolved();
      await expectAsync(helpers.get('requests')).toBeResolvedTo([{
        url: `/percy/comparison?${new URLSearchParams(params)}`,
        method: 'POST',
        body: options
      }]);
    });
  });

  describe('postBuildEvents(options)', () => {
    let { postBuildEvents } = utils;
    let options;

    beforeEach(() => {
      options = {
        errorMessage: 'someError',
        errorKind: 'sdk',
        cliVersion: '1.2.3'
      };
    });

    it('posts comparison options to the CLI API event endpoint', async () => {
      spyOn(utils.request, 'post').and.callFake(() => Promise.resolve());
      await expectAsync(postBuildEvents(options)).toBeResolved();
      await expectAsync(helpers.get('requests')).toBeResolvedTo({});
    });

    it('throws when the event API fails', async () => {
      await helpers.test('error', '/percy/events');

      await expectAsync(postBuildEvents({}))
        .toBeRejectedWithError('testing');
    });
  });

  describe('flushSnapshots([options])', () => {
    let { flushSnapshots } = utils;

    it('does nothing when percy is not enabled', async () => {
      await expectAsync(flushSnapshots()).toBeResolved();
      await expectAsync(helpers.get('requests')).toBeResolvedTo({});
    });

    it('posts options to the CLI API flush endpoint', async () => {
      utils.percy.enabled = true;

      await expectAsync(flushSnapshots()).toBeResolved();
      await expectAsync(flushSnapshots({ name: 'foo' })).toBeResolved();
      await expectAsync(flushSnapshots(['bar', 'baz'])).toBeResolved();

      await expectAsync(helpers.get('requests')).toBeResolvedTo([
        { url: '/percy/flush', method: 'POST' },
        { url: '/percy/flush', method: 'POST', body: [{ name: 'foo' }] },
        { url: '/percy/flush', method: 'POST', body: [{ name: 'bar' }, { name: 'baz' }] }
      ]);
    });
  });

  describe('logger()', () => {
    let browser = process.env.__PERCY_BROWSERIFIED__;
    let log, err, stdout, stderr;
    let { logger } = utils;

    let ANSI_REG = new RegExp('[\\u001B\\u009B][[\\]()#;?]*(' + (
      '(?:(?:[a-zA-Z\\d]*(?:;[-a-zA-Z\\d\\/#&.:=?%@~_]*)*)?\\u0007)|' +
      '(?:(?:\\d{1,4}(?:;\\d{0,4})*)?[\\dA-PR-TZcf-ntqry=><~]))'
    ), 'g');

    let captureLogs = acc => msg => {
      msg = msg.replace(/\r\n/g, '\n');
      msg = msg.replace(ANSI_REG, '');
      acc.push(msg.replace(/\n$/, ''));
    };

    beforeEach(async () => {
      await helpers.setupTest({ logger: false });
      err = new Error('Test error');
      err.stack = 'Error stack';
      log = utils.logger('test');
      stdout = [];
      stderr = [];

      if (browser) {
        spyOn(console, 'log').and.callFake(captureLogs(stdout));
        spyOn(console, 'warn').and.callFake(captureLogs(stderr));
        spyOn(console, 'error').and.callFake(captureLogs(stderr));
      } else {
        spyOn(process.stdout, 'write').and.callFake(captureLogs(stdout));
        spyOn(process.stderr, 'write').and.callFake(captureLogs(stderr));
      }
    });

    it('creates a minimal percy logger', async () => {
      log.info('Test info');
      log.warn('Test warn');
      log.error('Test error');
      log.error({ toString: () => 'Test error object' });
      log.error(err);

      // not logged because loglevel is not debug
      log.debug('Test debug');

      expect(stdout).toEqual([
        '[percy] Test info'
      ]);
      expect(stderr).toEqual([
        '[percy] Test warn',
        '[percy] Test error',
        '[percy] Test error object',
        '[percy] Error: Test error'
      ]);
    });

    it('logs the namespace when loglevel is debug', async () => {
      logger.loglevel('debug');

      log.info('Test debug info');
      log.debug('Test debug log');
      log.debug({ stack: 'Error like' });
      log.error(err);

      expect(stdout).toEqual([
        '[percy:test] Test debug info',
        // browser debug logs use console.log
        ...(browser ? [
          '[percy:test] Test debug log',
          '[percy:test] Error like'
        ] : [])
      ]);
      expect(stderr).toEqual([
        // node debug logs write to stderr
        ...(!browser ? [
          '[percy:test] Test debug log',
          '[percy:test] Error like'
        ] : []),
        '[percy:test] Error stack'
      ]);
    });

    it('sends logs to cli if log level is error', async () => {
      // we never want to await in real sdk but we await in test for validation
      await log.error('Some error', { name: 'abcd' });

      await expectAsync(helpers.get('requests')).toBeResolvedTo([{
        url: '/percy/log',
        method: 'POST',
        body: {
          level: 'error',
          message: jasmine.stringContaining('Some error'),
          meta: { name: 'abcd' }
        }
      }]);
    });

    it('sends all logs to cli if log level is debug', async () => {
      logger.loglevel('debug');
      // we never want to await in real sdk but we await in test for validation
      await log.error('Some error', { name: 'abcd' });
      await log.info('Some info', { name: 'abcd' });

      await expectAsync(helpers.get('requests')).toBeResolvedTo([{
        url: '/percy/log',
        method: 'POST',
        body: {
          level: 'error',
          message: jasmine.stringContaining('Some error'),
          meta: { name: 'abcd' }
        }
      }, {
        url: '/percy/log',
        method: 'POST',
        body: {
          level: 'info',
          message: jasmine.stringContaining('Some info'),
          meta: { name: 'abcd' }
        }
      }]);
    });

    it('sends logs error if sending to cli fails', async () => {
      await helpers.test('error', '/percy/log');
      // we never want to await in real sdk but we await in test for validation
      await log.error('Some error', { name: 'abcd' });

      expect(stderr).toEqual([
        '[percy] Some error',
        '[percy] Could not send logs to cli'
      ]);
    });
  });

  describe('getResponsiveWidths(widths)', () => {
    let { getResponsiveWidths } = utils;

    beforeEach(async () => {
      // Setup test environment with deviceDetails
      await helpers.test('config', {
        config: [375, 1280],
        deviceDetails: [
          { width: 390, height: 844 },
          { width: 428, height: 926 }
        ]
      });
    });

    afterEach(async () => {
      await helpers.test('config', { config: [375, 1280] });
    });

    it('calls the widths-config endpoint with widths query parameter', async () => {
      await expectAsync(getResponsiveWidths([768, 1024])).toBeResolved();
      await expectAsync(helpers.get('requests', r => r.url))
        .toBeResolvedTo(jasmine.arrayContaining(['/percy/widths-config?widths=768,1024']));
    });

    it('returns computed widths from the response', async () => {
      const result = await getResponsiveWidths([768, 1024]);

      expect(result).toEqual([
        { width: 390, height: 844 },
        { width: 428, height: 926 },
        { width: 768 },
        { width: 1024 }
      ]);
    });

    it('calls endpoint without query parameter when widths array is empty', async () => {
      await expectAsync(getResponsiveWidths([])).toBeResolved();
      await expectAsync(helpers.get('requests', r => r.url))
        .toBeResolvedTo(jasmine.arrayContaining(['/percy/widths-config']));
    });

    it('returns config widths when no widths are passed', async () => {
      const result = await getResponsiveWidths([]);

      expect(result).toEqual([
        { width: 375 },
        { width: 390, height: 844 },
        { width: 428, height: 926 },
        { width: 1280 }
      ]);
    });

    it('handles non-array widths by converting to empty array', async () => {
      await expectAsync(getResponsiveWidths('not-an-array')).toBeResolved();
      await expectAsync(helpers.get('requests', r => r.url))
        .toBeResolvedTo(jasmine.arrayContaining(['/percy/widths-config']));
    });

    it('handles undefined widths parameter', async () => {
      const result = await getResponsiveWidths();

      expect(result).toEqual([
        { width: 375 },
        { width: 390, height: 844 },
        { width: 428, height: 926 },
        { width: 1280 }
      ]);
    });

    it('returns empty array when the endpoint fails', async () => {
      helpers.logger.loglevel('debug');
      await helpers.test('error', '/percy/widths-config');
      const result = await getResponsiveWidths([768]);

      expect(result).toEqual([]);
      expect(helpers.logger.stderr).toEqual(jasmine.arrayContaining([
        jasmine.stringContaining('[percy:utils] Failed to get responsive widths: testing')
      ]));
    });

    it('returns empty array when the endpoint disconnects', async () => {
      await helpers.test('disconnect', '/percy/widths-config');
      const result = await getResponsiveWidths([768]);

      expect(result).toEqual([]);
    });

    it('handles response without widths property', async () => {
      // Mock a response that has a body but widths is null/undefined
      spyOn(utils.request, 'fetch').and.returnValue(Promise.resolve({
        status: 200,
        statusText: 'OK',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ success: true, widths: null })
      }));

      const result = await getResponsiveWidths([375]);

      expect(result).toEqual([]);
      expect(Array.isArray(result)).toBe(true);
    });

    it('returns empty array when server responds with non-array widths', async () => {
      spyOn(utils.request, 'fetch').and.returnValue(Promise.resolve({
        status: 200,
        statusText: 'OK',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ success: true, widths: {} })
      }));

      const result = await getResponsiveWidths([375]);

      expect(result).toEqual([]);
      expect(Array.isArray(result)).toBe(true);
    });

    it('properly formats multiple widths in query string', async () => {
      await getResponsiveWidths([375, 768, 1024, 1920]);

      await expectAsync(helpers.get('requests', r => r.url))
        .toBeResolvedTo(jasmine.arrayContaining(['/percy/widths-config?widths=375,768,1024,1920']));
    });

    it('handles single width value', async () => {
      const result = await getResponsiveWidths([768]);

      expect(result).toEqual([
        { width: 390, height: 844 },
        { width: 428, height: 926 },
        { width: 768 }
      ]);
    });
  });

  describe('iframe depth constants', () => {
    let { DEFAULT_MAX_IFRAME_DEPTH, HARD_MAX_IFRAME_DEPTH, clampIframeDepth } = utils;

    it('exposes the default and hard-cap depth values', () => {
      expect(DEFAULT_MAX_IFRAME_DEPTH).toEqual(3);
      expect(HARD_MAX_IFRAME_DEPTH).toEqual(10);
    });

    it('clamps a user-supplied depth to the hard cap', () => {
      expect(clampIframeDepth(50)).toEqual(10);
      expect(clampIframeDepth(11)).toEqual(10);
      expect(clampIframeDepth(10)).toEqual(10);
    });

    it('passes through valid in-range values', () => {
      expect(clampIframeDepth(1)).toEqual(1);
      expect(clampIframeDepth(5)).toEqual(5);
      expect(clampIframeDepth(9)).toEqual(9);
    });

    it('floors fractional values', () => {
      expect(clampIframeDepth(3.7)).toEqual(3);
    });

    it('falls back to the default for invalid input', () => {
      expect(clampIframeDepth(undefined)).toEqual(3);
      expect(clampIframeDepth(null)).toEqual(3);
      expect(clampIframeDepth(0)).toEqual(3);
      expect(clampIframeDepth(-1)).toEqual(3);
      expect(clampIframeDepth(NaN)).toEqual(3);
      expect(clampIframeDepth('abc')).toEqual(3);
    });

    // Node-only: reads the dom file from disk via fs to enforce parity
    // with @percy/sdk-utils' duplicated constants/clamp body. The karma
    // (browser) runs of this suite have a `process` polyfill but no real
    // `process.cwd`/`fs`, so guard on cwd being callable.
    const isNode = typeof process !== 'undefined' &&
      typeof process.cwd === 'function' &&
      !!(process.versions && process.versions.node);
    const itNode = isNode ? it : xit;

    itNode('stays in lockstep with @percy/dom/src/serialize-frames.js', async () => {
      // The constants + clampIframeDepth body are intentionally duplicated
      // across @percy/sdk-utils and @percy/dom (cross-package import broke
      // Node 14 CI in an earlier attempt). This test reads the dom source
      // and asserts the literal values + clamp body match — drift fails
      // loudly instead of silently.
      const fs = await import('fs');
      const path = await import('path');
      // sdk-utils tests run with cwd at the sdk-utils package root.
      const domSource = fs.readFileSync(
        path.resolve(process.cwd(), '../dom/src/serialize-frames.js'),
        'utf8'
      );
      expect(domSource).toContain('export const DEFAULT_MAX_IFRAME_DEPTH = 3;');
      expect(domSource).toContain('export const HARD_MAX_IFRAME_DEPTH = 10;');
      expect(domSource).toMatch(/function clampIframeDepth\(raw\) \{[^}]*Number\(raw\)[^}]*Number\.isFinite[^}]*DEFAULT_MAX_IFRAME_DEPTH[^}]*Math\.min\(Math\.floor\(n\), HARD_MAX_IFRAME_DEPTH\)/);
    });
  });

  describe('waitForReadyScript(config[, flags])', () => {
    let { waitForReadyScript } = utils;

    it('returns JS code that calls PercyDOM.waitForReady with graceful fallback', () => {
      let script = waitForReadyScript({ preset: 'balanced' });
      expect(script).toContain('PercyDOM.waitForReady');
      expect(script).toContain('"preset":"balanced"');
    });

    it('checks for PercyDOM.waitForReady existence before calling', () => {
      let script = waitForReadyScript();
      expect(script).toContain("typeof PercyDOM.waitForReady === 'function'");
      expect(script).toContain("typeof PercyDOM !== 'undefined'");
    });

    it('generates callback variant for executeAsyncScript', () => {
      let script = waitForReadyScript({ preset: 'fast' }, { callback: true });
      expect(script).toContain('arguments[arguments.length - 1]');
      expect(script).toContain('.then(');
      expect(script).toContain('.catch(');
      expect(script).toContain('done()');
    });

    it('callback variant catches errors gracefully', () => {
      let script = waitForReadyScript({}, { callback: true });
      expect(script).toContain('catch(function() { done(); })');
      expect(script).toContain('} catch(e) { done(); }');
    });

    it('default variant returns the waitForReady result as a bare expression', () => {
      let script = waitForReadyScript({ preset: 'strict' });
      expect(script).toContain('? PercyDOM.waitForReady');
      expect(script).not.toContain('arguments[arguments.length - 1]');
      // Regression (PER-7348): a top-level `return` is an "Illegal return
      // statement" when run via page.evaluate(string). The non-callback variant
      // must be an expression, never a statement with a leading `return`.
      expect(script).not.toContain('return PercyDOM.waitForReady');
    });

    it('escapes U+2028 and U+2029 in interpolated config so older engines can parse the source', () => {
      // U+2028 (LINE SEPARATOR) and U+2029 (PARAGRAPH SEPARATOR) are valid in JSON strings but
      // were illegal in JS source string literals before ES2019.
      let script = waitForReadyScript({
        readySelectors: ['header\u2028footer', 'main\u2029aside']
      });
      expect(script).toContain('\\u2028');
      expect(script).toContain('\\u2029');
      // raw separators must not be present in the emitted source
      expect(script.includes('\u2028')).toBe(false);
      expect(script.includes('\u2029')).toBe(false);
    });
  });

  describe('getReadinessConfig(snapshotOptions)', () => {
    let { getReadinessConfig, percy } = utils;

    it('returns empty object when no config exists (triggers balanced default)', () => {
      percy.config = undefined;
      expect(getReadinessConfig()).toEqual({});
      expect(getReadinessConfig({})).toEqual({});
    });

    it('returns global readiness config from percy.config', () => {
      percy.config = { snapshot: { readiness: { preset: 'strict' } } };
      expect(getReadinessConfig()).toEqual({ preset: 'strict' });
      percy.config = undefined;
    });

    it('returns per-snapshot readiness over global config', () => {
      percy.config = { snapshot: { readiness: { preset: 'balanced' } } };
      expect(getReadinessConfig({ readiness: { preset: 'fast' } })).toEqual({ preset: 'fast' });
      percy.config = undefined;
    });

    it('shallow-merges per-snapshot overrides into global config', () => {
      percy.config = {
        snapshot: {
          readiness: { preset: 'balanced', timeoutMs: 8000, stabilityWindowMs: 200 }
        }
      };
      // Partial override — `preset` and `timeoutMs` are inherited; `stabilityWindowMs` wins.
      expect(getReadinessConfig({ readiness: { stabilityWindowMs: 500 } })).toEqual({
        preset: 'balanced',
        timeoutMs: 8000,
        stabilityWindowMs: 500
      });
      percy.config = undefined;
    });

    it('inherits global preset: disabled when per-snapshot omits preset', () => {
      percy.config = { snapshot: { readiness: { preset: 'disabled' } } };
      // A partial override must NOT silently re-enable the kill switch.
      expect(getReadinessConfig({ readiness: { stabilityWindowMs: 500 } })).toEqual({
        preset: 'disabled',
        stabilityWindowMs: 500
      });
      percy.config = undefined;
    });

    it('empty per-snapshot readiness does not wipe the global config', () => {
      percy.config = { snapshot: { readiness: { preset: 'strict' } } };
      expect(getReadinessConfig({ readiness: {} })).toEqual({ preset: 'strict' });
      percy.config = undefined;
    });
  });

  describe('isReadinessDisabled(snapshotOptions)', () => {
    let { isReadinessDisabled, percy } = utils;

    it('returns false when no config (readiness is ON by default)', () => {
      percy.config = undefined;
      expect(isReadinessDisabled()).toBe(false);
    });

    it('returns true when preset is disabled', () => {
      percy.config = { snapshot: { readiness: { preset: 'disabled' } } };
      expect(isReadinessDisabled()).toBe(true);
      percy.config = undefined;
    });

    it('returns true for per-snapshot disabled', () => {
      expect(isReadinessDisabled({ readiness: { preset: 'disabled' } })).toBe(true);
    });

    it('returns false for any other preset', () => {
      percy.config = { snapshot: { readiness: { preset: 'strict' } } };
      expect(isReadinessDisabled()).toBe(false);
      percy.config = undefined;
    });
  });

  describe('runReadinessGate(evalScript, snapshotOptions[, opts])', () => {
    let { runReadinessGate, percy } = utils;

    afterEach(() => { percy.config = undefined; });

    it('returns null and skips evalScript when preset is disabled', async () => {
      let called = false;
      let result = await runReadinessGate(
        () => { called = true; return { passed: true }; },
        { readiness: { preset: 'disabled' } }
      );
      expect(result).toBe(null);
      expect(called).toBe(false);
    });

    it('returns null and skips evalScript when global preset is disabled', async () => {
      percy.config = { snapshot: { readiness: { preset: 'disabled' } } };
      let called = false;
      let result = await runReadinessGate(() => { called = true; });
      expect(result).toBe(null);
      expect(called).toBe(false);
    });

    it('passes the merged shallow-merge config script to evalScript and returns its result', async () => {
      percy.config = { snapshot: { readiness: { preset: 'balanced', timeoutMs: 8000, stabilityWindowMs: 200 } } };
      let captured;
      let diagnostics = { passed: true, timed_out: false, preset: 'balanced' };
      let result = await runReadinessGate(
        (script) => { captured = script; return Promise.resolve(diagnostics); },
        { readiness: { stabilityWindowMs: 500 } }
      );
      expect(result).toEqual(diagnostics);
      // Shallow-merged: per-snapshot stabilityWindowMs wins, global preset+timeoutMs inherited.
      expect(captured).toContain('"preset":"balanced"');
      expect(captured).toContain('"timeoutMs":8000');
      expect(captured).toContain('"stabilityWindowMs":500');
    });

    it('emits callback-mode script when opts.callback is true', async () => {
      let captured;
      await runReadinessGate(
        (script) => { captured = script; return null; },
        {},
        { callback: true }
      );
      expect(captured).toContain('arguments[arguments.length - 1]');
      expect(captured).toContain('PercyDOM.waitForReady');
    });

    it('emits promise-mode script by default', async () => {
      let captured;
      await runReadinessGate(
        (script) => { captured = script; return null; },
        {}
      );
      expect(captured).toContain('? PercyDOM.waitForReady');
      expect(captured).not.toContain('return PercyDOM.waitForReady');
      expect(captured).not.toContain('arguments[arguments.length - 1]');
    });

    it('returns null and never throws when evalScript rejects (with Error)', async () => {
      let logged;
      let result = await runReadinessGate(
        () => Promise.reject(new Error('readiness boom')),
        {},
        { log: { debug: (m) => { logged = m; } } }
      );
      expect(result).toBe(null);
      expect(logged).toContain('readiness boom');
    });

    it('returns null and never throws when evalScript rejects (non-Error)', async () => {
      let logged;
      // Exercises the `err?.message || err` second branch where the
      // rejection value has no `.message`.
      let result = await runReadinessGate(
        // eslint-disable-next-line prefer-promise-reject-errors
        () => Promise.reject('plain-string-rejection'),
        {},
        { log: { debug: (m) => { logged = m; } } }
      );
      expect(result).toBe(null);
      expect(logged).toContain('plain-string-rejection');
    });

    it('returns null and never throws when evalScript throws synchronously', async () => {
      let result = await runReadinessGate(() => { throw new Error('sync boom'); }, {});
      expect(result).toBe(null);
    });

    it('tolerates absent log (no opts.log)', async () => {
      let result = await runReadinessGate(() => Promise.reject(new Error('no log')), {});
      expect(result).toBe(null);
    });
  });

  describe('mergeSnapshotOptions(options)', () => {
    let { mergeSnapshotOptions } = utils;

    beforeEach(async () => {
      await helpers.setupTest();
      await utils.isPercyEnabled();
    });

    it('merges config snapshot options with per-snapshot options', () => {
      const result = mergeSnapshotOptions({ enableJavaScript: true });
      expect(result.enableJavaScript).toBe(true);
      expect(result.widths).toEqual([375, 1280]);
    });

    it('gives per-snapshot options priority over config', () => {
      const result = mergeSnapshotOptions({ widths: [768] });
      expect(result.widths).toEqual([768]);
    });

    it('returns config options when no per-snapshot options are provided', () => {
      const result = mergeSnapshotOptions();
      expect(result.widths).toEqual([375, 1280]);
    });

    it('returns empty object when config.snapshot is undefined and no options given', () => {
      const savedConfig = utils.percy.config;
      utils.percy.config = { ...savedConfig, snapshot: undefined };

      const result = mergeSnapshotOptions();
      expect(result).toEqual({});

      utils.percy.config = savedConfig;
    });

    it('returns only per-snapshot options when config.snapshot is undefined', () => {
      const savedConfig = utils.percy.config;
      utils.percy.config = { ...savedConfig, snapshot: undefined };

      const result = mergeSnapshotOptions({ enableJavaScript: true });
      expect(result).toEqual({ enableJavaScript: true });

      utils.percy.config = savedConfig;
    });

    it('deep-merges nested objects, keeping config sibling keys not overridden', () => {
      const savedConfig = utils.percy.config;
      utils.percy.config = {
        ...savedConfig,
        snapshot: { discovery: { networkIdleTimeout: 50, disableCache: false } }
      };

      const result = mergeSnapshotOptions({ discovery: { disableCache: true } });
      // per-snapshot wins on the overridden nested key, config sibling key survives
      expect(result.discovery).toEqual({ networkIdleTimeout: 50, disableCache: true });

      utils.percy.config = savedConfig;
    });

    it('replaces (does not concatenate) arrays from per-snapshot options', () => {
      const savedConfig = utils.percy.config;
      utils.percy.config = { ...savedConfig, snapshot: { widths: [375, 1280] } };

      const result = mergeSnapshotOptions({ widths: [768] });
      expect(result.widths).toEqual([768]);

      utils.percy.config = savedConfig;
    });
  });
});
