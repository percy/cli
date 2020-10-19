import expect from 'expect';
import colors from 'colors/safe';
import sdk from './helper';

describe('SDK Utils', () => {
  let label = colors.magenta('percy');

  beforeEach(async () => {
    await sdk.setup();
  });

  afterEach(async () => {
    await sdk.teardown();
  });

  describe('log(level, msg)', () => {
    let log;

    it('logs info messages by default', () => {
      ({ log } = sdk.rerequire('..'));

      sdk.stdio(() => {
        log('info', 'informational');
        log('warn', 'warning');
        log('error', new Error('test'));
        log('debug', 'wat?');
      }, { colors: true });

      expect(sdk.stdio[1]).toEqual([
        `[${label}] informational\n`
      ]);
      expect(sdk.stdio[2]).toEqual([
        `[${label}] ${colors.yellow('warning')}\n`,
        `[${label}] ${colors.red('Error: test')}\n`
      ]);
    });

    it('logs warnings and errors when PERCY_LOGLEVEL is "warn"', () => {
      process.env.PERCY_LOGLEVEL = 'warn';
      ({ log } = sdk.rerequire('..'));

      sdk.stdio(() => {
        log('info', 'informational');
        log('warn', 'warning');
        log('error', new Error('test'));
        log('debug', 'wat?');
      }, { colors: true });

      expect(sdk.stdio[1]).toEqual([]);
      expect(sdk.stdio[2]).toEqual([
        `[${label}] ${colors.yellow('warning')}\n`,
        `[${label}] ${colors.red('Error: test')}\n`
      ]);
    });

    it('logs only errors when PERCY_LOGLEVEL is "error"', () => {
      process.env.PERCY_LOGLEVEL = 'error';
      ({ log } = sdk.rerequire('..'));

      sdk.stdio(() => {
        log('info', 'informational');
        log('warn', 'warning');
        log('error', new Error('test'));
        log('debug', 'wat?');
      }, { colors: true });

      expect(sdk.stdio[1]).toEqual([]);
      expect(sdk.stdio[2]).toEqual([
        `[${label}] ${colors.red('Error: test')}\n`
      ]);
    });

    it('logs debug messages and errors stacks when PERCY_LOGLEVEL is "debug"', () => {
      let error = new Error('test');
      process.env.PERCY_LOGLEVEL = 'debug';

      sdk.stdio(() => {
        ({ log } = sdk.rerequire('..'));
        log('info', 'informational');
        log('warn', 'warning');
        log('error', error);
        log('debug', 'wat?');
      }, { colors: true });

      expect(sdk.stdio[1]).toEqual([
        `[${label}] informational\n`,
        `[${label}] wat?\n`
      ]);
      expect(sdk.stdio[2]).toEqual([
        `[${label}] ${colors.yellow('warning')}\n`,
        `[${label}] ${colors.red(error.stack)}\n`
      ]);
    });

    it('does not log when PERCY_LOGLEVEL is unknown', () => {
      process.env.PERCY_LOGLEVEL = 'silent';
      ({ log } = sdk.rerequire('..'));

      sdk.stdio(() => {
        log('info', 'informational');
        log('warn', 'warning');
        log('error', new Error('test'));
        log('debug', 'wat?');
      }, { colors: true });

      expect(sdk.stdio[1]).toEqual([]);
      expect(sdk.stdio[2]).toEqual([]);
    });
  });

  describe('getInfo()', () => {
    it('returns the CLI API address as defined by PERCY_CLI_API', () => {
      expect(process.env.PERCY_CLI_API).toBeUndefined();
      expect(sdk.rerequire('..').getInfo())
        .toHaveProperty('cliApi', 'http://localhost:5338/percy');
      delete require.cache[require.resolve('..')];

      process.env.PERCY_CLI_API = 'http://localhost:1234/percy';
      expect(sdk.rerequire('..').getInfo())
        .toHaveProperty('cliApi', 'http://localhost:1234/percy');
    });

    it('returns the loglevel as defined by PERCY_LOGLEVEL', () => {
      expect(process.env.PERCY_LOGLEVEL).toBeUndefined();
      expect(sdk.rerequire('..').getInfo()).toHaveProperty('loglevel', 'info');
      delete require.cache[require.resolve('..')];

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

      await expect(sdk.stdio(() => isPercyEnabled()))
        .resolves.toBe(false);

      expect(sdk.stdio[1]).toEqual([
        '[percy] Percy is not running, disabling snapshots\n'
      ]);
    });

    it('disables snapshots when the request errors', async () => {
      sdk.test.error('/percy/healthcheck');

      await expect(sdk.stdio(() => isPercyEnabled()))
        .resolves.toBe(false);

      expect(sdk.stdio[1]).toEqual([
        '[percy] Percy is not running, disabling snapshots\n'
      ]);
    });

    it('disables snapshots when the API version is unsupported', async () => {
      sdk.server.version = '';

      await expect(sdk.stdio(() => isPercyEnabled()))
        .resolves.toBe(false);

      expect(sdk.stdio[1]).toEqual([
        '[percy] Unsupported Percy CLI version, disabling snapshots\n'
      ]);
    });
  });

  describe('fetchPercyDOM()', () => {
    let fetchPercyDOM;

    it('fetches @percy/dom from the CLI API and caches the result', async () => {
      ({ fetchPercyDOM } = sdk.rerequire('..'));
      await expect(fetchPercyDOM()).resolves.toEqual(
        'window.PercyDOM = { serialize: () => document.documentElement.outerHTML }');
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
