import helpers from './helpers.js';
import utils from '@percy/sdk-utils';

describe('SDK Utils', () => {
  let browser = process.env.__PERCY_BROWSERIFIED__;

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

      await expectAsync(helpers.get('logs'))
        .toBeResolvedTo(jasmine.arrayContaining([
          'Percy is not running, disabling snapshots'
        ]));
    });

    it('disables snapshots when the request errors', async () => {
      await helpers.test('disconnect', '/percy/healthcheck');
      await expectAsync(isPercyEnabled()).toBeResolvedTo(false);

      await expectAsync(helpers.get('logs'))
        .toBeResolvedTo(jasmine.arrayContaining([
          'Percy is not running, disabling snapshots'
        ]));
    });

    it('disables snapshots when the API version is unsupported', async () => {
      await helpers.test('version', '0.1.0');
      await expectAsync(isPercyEnabled()).toBeResolvedTo(false);

      await expectAsync(helpers.get('logs'))
        .toBeResolvedTo(jasmine.arrayContaining([
          'Unsupported Percy CLI version, disabling snapshots'
        ]));
    });

    it('enables remote logging on success', async () => {
      await expectAsync(isPercyEnabled()).toBeResolvedTo(true);
      expect(utils.logger.remote.socket).toBeDefined();
    });

    it('returns false if the build fails during a snapshot', async () => {
      await helpers.test('error', '/percy/snapshot');
      await helpers.test('build-error', 'build failed');

      await expectAsync(isPercyEnabled()).toBeResolvedTo(true);
      await expectAsync(utils.postSnapshot({})).toBeResolved();
      await expectAsync(isPercyEnabled()).toBeResolvedTo(false);
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
      await expectAsync(postSnapshot(options)).toBeResolved();
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
      await helpers.test('build-error', 'build failed');
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

  describe('logger()', () => {
    let err, log, stdout, stderr;
    let { logger } = utils;

    let ANSI_REG = new RegExp('[\\u001B\\u009B][[\\]()#;?]*(' +
      '(?:(?:[a-zA-Z\\d]*(?:;[-a-zA-Z\\d\\/#&.:=?%@~_]*)*)?\\u0007)|' +
      '(?:(?:\\d{1,4}(?:;\\d{0,4})*)?[\\dA-PR-TZcf-ntqry=><~]))', 'g');

    let captureLogs = acc => msg => {
      msg = msg.replace(/\r\n/g, '\n');
      msg = msg.replace(ANSI_REG, '');
      acc.push(msg.replace(/\n$/, ''));
    };

    beforeEach(async () => {
      await helpers.test('remote-logging', false);
      while (logger.remote.socket) await new Promise(r => setTimeout(r, 0));

      err = new Error('Test error');
      err.stack = 'Error stack';
      logger.loglevel('info');
      log = logger('test');
      stdout = [];
      stderr = [];

      if (process.env.__PERCY_BROWSERIFIED__) {
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
      log.error(err);

      expect(stdout).toEqual([
        '[percy:test] Test debug info',
        // browser debug logs use console.log
        ...(browser ? ['[percy:test] Test debug log'] : [])
      ]);
      expect(stderr).toEqual([
        // node debug logs write to stderr
        ...(!browser ? ['[percy:test] Test debug log'] : []),
        '[percy:test] Error stack'
      ]);
    });

    it('can connect to a remote percy logger instance', async () => {
      await helpers.test('remote-logging', true);
      await logger.remote();

      let socket = logger.remote.socket;
      expect(socket).not.toBeNull();

      // does not initiate new connections once connected
      await logger.remote();
      expect(logger.remote.socket).toBe(socket);

      // does not log locally, but sends logs remotely
      log.info('Test foo');
      log.error(err);

      expect(stderr).toEqual([]);
      expect(stdout).toEqual([]);

      await expectAsync(helpers.get('logs', l => l))
        .toBeResolvedTo([
          jasmine.objectContaining({
            debug: 'test',
            level: 'info',
            message: 'Test foo',
            meta: { remote: true }
          }),
          jasmine.objectContaining({
            debug: 'test',
            level: 'error',
            message: 'Error stack',
            meta: { remote: true },
            error: true
          })
        ]);
    });

    it('sends any existing logs to the connected remote logger', async () => {
      log.info('Test info');
      log.warn('Test warn');
      log.error(err);

      await expectAsync(helpers.get('logs'))
        .toBeResolvedTo([]);

      expect(stdout).toHaveSize(1);
      expect(stderr).toHaveSize(2);

      await helpers.test('remote-logging', true);
      await logger.remote();

      await expectAsync(helpers.get('logs'))
        .toBeResolvedTo(['Test info', 'Test warn', 'Error stack']);
    });

    it('sets the local loglevel to reflect the connected remote logger', async () => {
      delete utils.logger.loglevel.lvl;
      expect(logger.loglevel()).toEqual('info');

      await helpers.test('remote-logging', true);
      await logger.remote();

      // remove logger is silent during testing mode
      expect(utils.logger.loglevel.lvl).toEqual('silent');
      expect(logger.loglevel()).toEqual('silent');
    });

    it('silently handles remote connection errors', async () => {
      let addr = utils.percy.address;
      utils.percy.address = 'http://no.localhost:9999';
      await logger.remote().then(() => (utils.percy.address = addr));

      log.info('Test remote');

      expect(logger.remote.socket).toBeFalsy();
      await expectAsync(helpers.get('logs')).toBeResolvedTo([]);
      expect(stdout).toEqual(['[percy] Test remote']);
      expect(stderr).toEqual([]);
    });

    it('logs debug messages for remote connection errors', async () => {
      logger.loglevel('debug');

      let addr = utils.percy.address;
      utils.percy.address = 'http://no.localhost:9999';
      await logger.remote().then(() => (utils.percy.address = addr));

      log.info('Test remote');

      expect(logger.remote.socket).toBeFalsy();
      await expectAsync(helpers.get('logs')).toBeResolvedTo([]);
      // node debug logs write to stderr; browser debug logs use console.log
      expect(browser ? stdout : stderr).toEqual(jasmine.arrayContaining([
        '[percy:utils] Unable to connect to remote logger',
        jasmine.stringMatching(
          // node throws a real error while browsers show console logs
          browser ? /Socket connection (failed|timed out)/ : /ECONNREFUSED|ENOTFOUND/
        )
      ]));
    });
  });
});
