import helpers from './helpers.js';
import utils from '@percy/sdk-utils';

describe('SDK Utils', () => {
  let browser = process.env.__PERCY_BROWSERIFIED__;

  beforeEach(async () => {
    await helpers.setup();
  });

  afterEach(async () => {
    await helpers.teardown();
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
        await helpers.call('server.version', '1.2.3-beta.4');

        await helpers.testReply('/percy/healthcheck', [200, 'application/json', {
          config: { snapshot: { widths: [1080] } },
          success: true
        }]);

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
        expect(percy).toHaveProperty('config.snapshot.widths', [1080]);
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
      await expectAsync(helpers.getRequests()).toBeResolvedTo([['/percy/healthcheck']]);
    });

    it('disables snapshots when the healthcheck fails', async () => {
      await helpers.testFailure('/percy/healthcheck');
      await expectAsync(isPercyEnabled()).toBeResolvedTo(false);

      expect(helpers.logger.stdout).toEqual([
        '[percy] Percy is not running, disabling snapshots'
      ]);
    });

    it('disables snapshots when the request errors', async () => {
      await helpers.testError('/percy/healthcheck');
      await expectAsync(isPercyEnabled()).toBeResolvedTo(false);

      expect(helpers.logger.stdout).toEqual([
        '[percy] Percy is not running, disabling snapshots'
      ]);
    });

    it('disables snapshots when the API version is unsupported', async () => {
      await helpers.call('server.version', '0.1.0');
      await expectAsync(isPercyEnabled()).toBeResolvedTo(false);

      expect(helpers.logger.stdout).toEqual([
        '[percy] Unsupported Percy CLI version, disabling snapshots'
      ]);
    });

    it('enables remote logging on success', async () => {
      await helpers.call('server.test.remote');
      await expectAsync(isPercyEnabled()).toBeResolvedTo(true);
      expect(utils.logger.remote.socket).toBeDefined();
    });

    it('returns false if a snapshot is sent when the API is closed', async () => {
      let error = 'Build failed';
      await helpers.testFailure('/percy/snapshot', error, { build: { error } });
      await expectAsync(isPercyEnabled()).toBeResolvedTo(true);
      await expectAsync(utils.postSnapshot({})).toBeResolved();
      await expectAsync(isPercyEnabled()).toBeResolvedTo(false);
    });
  });

  describe('waitForPercyIdle()', () => {
    let { waitForPercyIdle } = utils;

    it('gets idle state from the CLI API idle endpoint', async () => {
      await expectAsync(waitForPercyIdle()).toBeResolvedTo(true);
      await expectAsync(helpers.getRequests()).toBeResolvedTo([['/percy/idle']]);
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
      await expectAsync(fetchPercyDOM()).toBeResolvedTo(
        `window.PercyDOM = { serialize: ${await helpers.testSerialize()} }`);
      await expectAsync(fetchPercyDOM()).toBeResolved();
      await expectAsync(helpers.getRequests()).toBeResolvedTo([['/percy/dom.js']]);
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
      await expectAsync(helpers.getRequests()).toBeResolvedTo([['/percy/snapshot', options]]);
    });

    it('throws when the snapshot API fails', async () => {
      await helpers.testFailure('/percy/snapshot', 'foobar');
      await expectAsync(postSnapshot({})).toBeRejectedWithError('foobar');
    });

    it('disables snapshots when the API is closed', async () => {
      let error = 'Build failed';
      utils.percy.enabled = true;
      await helpers.testFailure('/percy/snapshot', error, { build: { error } });
      await expectAsync(postSnapshot({})).toBeResolved();
      expect(utils.percy.enabled).toEqual(false);
    });

    it('accepts URL parameters as the second argument', async () => {
      let params = { test: 'foobar' };
      let expected = `/percy/snapshot?${new URLSearchParams(params)}`;

      await expectAsync(postSnapshot(options, params)).toBeResolved();
      await expectAsync(helpers.getRequests()).toBeResolvedTo([[expected, options]]);
    });
  });

  describe('logger()', () => {
    let { logger } = utils;
    let err, log;

    beforeEach(() => {
      err = new Error('Test error');
      err.stack = 'Error stack';
      log = logger('test');
    });

    it('creates a minimal percy logger', async () => {
      log.info('Test info');
      log.warn('Test warn');
      log.error('Test error');
      log.error({ toString: () => 'Test error object' });
      log.error(err);

      expect(helpers.logger.stdout).toEqual([
        '[percy] Test info'
      ]);
      expect(helpers.logger.stderr).toEqual([
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

      expect(helpers.logger.stdout).toEqual([
        '[percy:test] Test debug info',
        // browser debug logs use console.log
        ...(browser ? ['[percy:test] Test debug log'] : [])
      ]);
      expect(helpers.logger.stderr).toEqual([
        // node debug logs write to stderr
        ...(!browser ? ['[percy:test] Test debug log'] : []),
        '[percy:test] Error stack'
      ]);
    });

    it('can connect to a remote percy logger instance', async () => {
      await helpers.call('server.test.remote');

      // no remote connection
      expect(logger.remote.socket).toBeFalsy();

      log.info('Test foo');
      // expect logs do not log remotely
      expect(helpers.logger.stderr).toEqual([]);
      expect(helpers.logger.stdout).toEqual(['[percy] Test foo']);
      await expectAsync(helpers.call('server.messages')).toBeResolvedTo([]);

      // initiate and expect remote connection
      await logger.remote();
      expect(logger.remote.socket).toBeDefined();

      // does not initiate new connections once connected
      let socket = logger.remote.socket;
      await logger.remote();
      expect(logger.remote.socket).toBe(socket);

      log.info('Test bar');
      log.error(err);
      // expect logs do not log locally
      expect(helpers.logger.stderr).toEqual([]);
      expect(helpers.logger.stdout).toEqual(['[percy] Test foo']);

      // wait for remote message to be recieved
      await new Promise(r => setTimeout(r, 100));

      // expect remote messages have been received
      await expectAsync(
        helpers.call('server.messages')
          .then(msgs => msgs.map(JSON.parse))
      ).toBeResolvedTo([{
        messages: [{
          debug: 'test',
          level: 'info',
          message: 'Test foo',
          timestamp: jasmine.any(Number),
          meta: { remote: true }
        }]
      }, {
        log: ['test', 'info', 'Test bar', { remote: true }]
      }, {
        log: ['test', 'error', {
          // error objects should be serialized
          name: 'Error',
          message: 'Test error',
          stack: 'Error stack'
        }, { remote: true }]
      }]);
    });

    it('silently handles remote connection errors', async () => {
      let log = logger('test');
      await helpers.call('server.test.remote');
      utils.percy.address = 'http://no.localhost:9999';

      await logger.remote();
      expect(logger.remote.socket).toBeFalsy();

      log.info('Test remote');
      expect(helpers.logger.stderr).toEqual([]);
      expect(helpers.logger.stdout).toEqual(['[percy] Test remote']);
      await expectAsync(helpers.call('server.messages')).toBeResolvedTo([]);

      // with debug logs
      helpers.logger.reset();
      logger.loglevel('debug');
      await logger.remote();

      // node debug logs write to stderr; browser debug logs use console.log
      expect(helpers.logger[browser ? 'stdout' : 'stderr']).toEqual([
        '[percy:utils] Unable to connect to remote logger',
        jasmine.stringMatching(
          // node throws a real error while browsers show console logs
          browser ? /Socket connection (failed|timed out)/ : /ECONNREFUSED|ENOTFOUND/
        )
      ]);
    });
  });
});
