import helpers from './helpers';
import utils from '../src';

describe('SDK Utils', () => {
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
      await helpers.call('server.version', '');
      await expectAsync(isPercyEnabled()).toBeResolvedTo(false);

      expect(helpers.logger.stdout).toEqual([
        '[percy] Unsupported Percy CLI version, disabling snapshots'
      ]);
    });

    it('enables remote logging on success', async () => {
      await helpers.call('server.test.remote');
      await expectAsync(isPercyEnabled()).toBeResolvedTo(true);
      utils.logger('testing:utils').info('Test remote logging');

      // wait briefly for remote to receive the message
      await new Promise(r => setTimeout(r, 500));

      expect(helpers.logger.stdout).toEqual([]);
      expect(helpers.logger.stderr).toEqual([]);
      expectAsync(helpers.call('server.messages')).toBeResolvedTo([JSON.stringify({
        log: ['testing:utils', 'info', 'Test remote logging', { remote: true }]
      })]);
    });

    it('logs debug info when the remote logger fails to connect', async () => {
      // trigger an unexpected error via percy.address
      let t = { i: 0, addr: utils.percy.address };
      spyOnProperty(utils.percy, 'address').and.callFake(() => t.i++ || t.addr);

      utils.logger.loglevel('debug');
      await expectAsync(isPercyEnabled()).toBeResolvedTo(true);
      utils.logger('testing:utils').info('Test remote logging');

      // wait briefly for remote to receive the message
      await new Promise(r => setTimeout(r, 100));

      expect(helpers.logger.stderr[0]).toEqual(
        '[percy:utils] Unable to connect to remote logger');
      expect(helpers.logger.stdout).toEqual([
        '[percy:testing:utils] Test remote logging']);
      expectAsync(helpers.call('server.messages'))
        .toBeResolvedTo([]);
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

  describe('postSnapshot(options)', () => {
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
  });
});
