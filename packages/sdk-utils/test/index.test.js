import expect from 'expect';
import sdk from './helper';

describe('SDK Utils', () => {
  beforeEach(async () => {
    await sdk.setup();
  });

  afterEach(async () => {
    await sdk.teardown();
  });

  describe('getInfo()', () => {
    it('returns the CLI API address as defined by PERCY_CLI_API', () => {
      expect(process.env.PERCY_CLI_API).toBeUndefined();
      expect(sdk.rerequire('..').getInfo())
        .toHaveProperty('cliApi', 'http://localhost:5338');
      delete require.cache[require.resolve('..')];

      process.env.PERCY_CLI_API = 'http://localhost:1234';
      expect(sdk.rerequire('..').getInfo())
        .toHaveProperty('cliApi', 'http://localhost:1234');
    });

    it('returns the loglevel as defined by PERCY_LOGLEVEL', () => {
      delete sdk.logger.instance;
      expect(process.env.PERCY_LOGLEVEL).toBeUndefined();
      expect(sdk.rerequire('..').getInfo()).toHaveProperty('loglevel', 'info');
      delete require.cache[require.resolve('..')];

      delete sdk.logger.instance;
      process.env.PERCY_LOGLEVEL = 'debug';
      expect(sdk.rerequire('..').getInfo()).toHaveProperty('loglevel', 'debug');
    });

    describe('after calling isPercyEnabled()', () => {
      let getInfo, isPercyEnabled;

      beforeEach(async () => {
        ({ getInfo, isPercyEnabled } = sdk.rerequire('..'));

        sdk.server.reply('/percy/healthcheck', () => [200, 'application/json', {
          config: { snapshot: { widths: [1080] } },
          success: true
        }]);

        await expect(isPercyEnabled()).resolves.toBe(true);
      });

      it('returns the CLI version', () => {
        expect(getInfo()).toHaveProperty('version.0', 1);
      });

      it('returns CLI config', () => {
        expect(getInfo()).toHaveProperty('config.snapshot.widths', [1080]);
      });
    });
  });

  describe('isPercyEnabled()', () => {
    let isPercyEnabled;

    beforeEach(() => ({ isPercyEnabled } = sdk.rerequire('..')));

    it('calls the healthcheck endpoint once and caches the result', async () => {
      await expect(isPercyEnabled()).resolves.toBe(true);
      await expect(isPercyEnabled()).resolves.toBe(true);
      await expect(isPercyEnabled()).resolves.toBe(true);
      expect(sdk.server.requests).toEqual([['/percy/healthcheck']]);
    });

    it('disables snapshots when the healthcheck fails', async () => {
      sdk.test.failure('/percy/healthcheck');

      await expect(isPercyEnabled())
        .resolves.toBe(false);

      expect(sdk.logger.stdout).toEqual([
        '[percy] Percy is not running, disabling snapshots\n'
      ]);
    });

    it('disables snapshots when the request errors', async () => {
      sdk.test.error('/percy/healthcheck');

      await expect(isPercyEnabled())
        .resolves.toBe(false);

      expect(sdk.logger.stdout).toEqual([
        '[percy] Percy is not running, disabling snapshots\n'
      ]);
    });

    it('disables snapshots when the API version is unsupported', async () => {
      sdk.server.version = '';

      await expect(isPercyEnabled())
        .resolves.toBe(false);

      expect(sdk.logger.stdout).toEqual([
        '[percy] Unsupported Percy CLI version, disabling snapshots\n'
      ]);
    });
  });

  describe('fetchPercyDOM()', () => {
    let fetchPercyDOM;

    it('fetches @percy/dom from the CLI API and caches the result', async () => {
      ({ fetchPercyDOM } = sdk.rerequire('..'));
      await expect(fetchPercyDOM()).resolves.toEqual(
        `window.PercyDOM = { serialize: ${sdk.serializeDOM.toString()} }`);
      await expect(fetchPercyDOM()).resolves.toBeDefined();
      expect(sdk.server.requests).toEqual([['/percy/dom.js']]);
    });
  });

  describe('postSnapshot(options)', () => {
    let postSnapshot;

    it('posts snapshot options to the CLI API snapshot endpoint', async () => {
      ({ postSnapshot } = sdk.rerequire('..'));

      let options = {
        name: 'Snapshot Name',
        url: 'http://localhost:8000/',
        domSnapshot: '<SERIALIZED_DOM>',
        clientInfo: 'sdk/version',
        environmentInfo: ['lib/version', 'lang/version'],
        enableJavaScript: true
      };

      await expect(postSnapshot(options)).resolves.toBeUndefined();
      expect(sdk.server.requests).toEqual([['/percy/snapshot', options]]);
    });

    it('throws when the snapshot API fails', async () => {
      sdk.test.failure('/percy/snapshot', 'foobar');
      await expect(postSnapshot({})).rejects.toThrow('foobar');
    });
  });
});
