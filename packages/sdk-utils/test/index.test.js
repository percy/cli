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
      delete sdk.logger.reset();
      expect(process.env.PERCY_LOGLEVEL).toBeUndefined();
      expect(sdk.rerequire('..').getInfo()).toHaveProperty('loglevel', 'info');
      delete require.cache[require.resolve('..')];

      delete sdk.logger.reset();
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

        await expectAsync(isPercyEnabled()).toBeResolvedTo(true);
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
      await expectAsync(isPercyEnabled()).toBeResolvedTo(true);
      await expectAsync(isPercyEnabled()).toBeResolvedTo(true);
      await expectAsync(isPercyEnabled()).toBeResolvedTo(true);
      expect(sdk.server.requests).toEqual([['/percy/healthcheck']]);
    });

    it('disables snapshots when the healthcheck fails', async () => {
      sdk.test.failure('/percy/healthcheck');

      await expectAsync(isPercyEnabled()).toBeResolvedTo(false);

      expect(sdk.logger.stdout).toEqual([
        '[percy] Percy is not running, disabling snapshots\n'
      ]);
    });

    it('disables snapshots when the request errors', async () => {
      sdk.test.error('/percy/healthcheck');

      await expectAsync(isPercyEnabled()).toBeResolvedTo(false);

      expect(sdk.logger.stdout).toEqual([
        '[percy] Percy is not running, disabling snapshots\n'
      ]);
    });

    it('disables snapshots when the API version is unsupported', async () => {
      sdk.server.version = '';

      await expectAsync(isPercyEnabled()).toBeResolvedTo(false);

      expect(sdk.logger.stdout).toEqual([
        '[percy] Unsupported Percy CLI version, disabling snapshots\n'
      ]);
    });
  });

  describe('fetchPercyDOM()', () => {
    let fetchPercyDOM;

    beforeEach(() => {
      ({ fetchPercyDOM } = sdk.rerequire('..'));
    });

    it('fetches @percy/dom from the CLI API and caches the result', async () => {
      await expectAsync(fetchPercyDOM()).toBeResolvedTo(
        `window.PercyDOM = { serialize: ${sdk.serializeDOM.toString()} }`);
      await expectAsync(fetchPercyDOM()).toBeResolved();
      expect(sdk.server.requests).toEqual([['/percy/dom.js']]);
    });
  });

  describe('postSnapshot(options)', () => {
    let postSnapshot, options;

    beforeEach(() => {
      ({ postSnapshot } = sdk.rerequire('..'));

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
      expect(sdk.server.requests).toEqual([['/percy/snapshot', options]]);
    });

    it('throws when the snapshot API fails', async () => {
      sdk.test.failure('/percy/snapshot', 'foobar');
      await expectAsync(postSnapshot({})).toBeRejectedWithError('foobar');
    });
  });
});
