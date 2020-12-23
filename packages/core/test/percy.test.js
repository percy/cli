import expect from 'expect';
import fetch from 'node-fetch';
import Percy from '../src';
import { mockAPI, stdio, createTestServer, dedent } from './helpers';
import { sha256hash, base64encode } from '@percy/client/dist/utils';

describe('Percy', () => {
  let percy, server;

  beforeEach(() => {
    percy = new Percy({
      token: 'PERCY_TOKEN',
      snapshot: { widths: [1000] },
      discovery: { concurrency: 1 },
      concurrency: 1
    });
  });

  afterEach(async () => {
    percy.loglevel('error');
    await percy.stop();
    await server?.close();
  });

  it('scrubs invalid config options and loads defaults', () => {
    percy = new Percy({ snapshot: { foo: 'bar' } });

    expect(percy.config.snapshot).toEqual({
      widths: [375, 1280],
      requestHeaders: {},
      minHeight: 1024,
      percyCSS: ''
    });
  });

  it('does not scrub invalid config options when the config option is false', () => {
    percy = new Percy({
      config: false,
      snapshot: { foo: 'bar' }
    });

    expect(percy.config.snapshot).toEqual({
      widths: [375, 1280],
      requestHeaders: {},
      minHeight: 1024,
      percyCSS: '',
      foo: 'bar'
    });
  });

  describe('.start()', () => {
    // rather than stub prototypes, extend and mock
    class TestPercy extends Percy {
      constructor(...args) {
        super(...args);
        this.test = { new: args };
      }

      start() {
        this.test.started = true;
      }
    }

    it('creates a new instance with the provided options', async () => {
      percy = await TestPercy.start({
        token: 'PERCY_TOKEN',
        loglevel: 'error',
        foo: 'bar'
      });

      expect(percy.test.new).toEqual([{
        token: 'PERCY_TOKEN',
        loglevel: 'error',
        foo: 'bar'
      }]);
    });

    it('calls #start() on the new instance', async () => {
      percy = await TestPercy.start({ token: 'PERCY_TOKEN' });
      expect(percy.test.started).toEqual(true);
    });
  });

  describe('#loglevel()', () => {
    it('returns the default loglevel', () => {
      expect(percy.loglevel()).toBe('error');
    });

    it('returns the specified loglevel', () => {
      percy = new Percy({ loglevel: 'warn' });
      expect(percy.loglevel()).toBe('warn');
    });

    it('sets the loglevel', () => {
      expect(percy.loglevel()).toBe('error');
      percy.loglevel('debug');
      expect(percy.loglevel()).toBe('debug');
    });
  });

  describe('#apiAddress()', () => {
    it('returns the server API address', async () => {
      expect(percy.apiAddress()).toEqual('http://localhost:5338');
    });
  });

  describe('#start()', () => {
    it('launches a browser', async () => {
      await expect(percy.start()).resolves.toBeUndefined();
      expect(percy.discoverer.isConnected()).toBe(true);
    });

    it('creates a build', async () => {
      await expect(percy.start()).resolves.toBeUndefined();
      expect(mockAPI.requests['/builds']).toBeDefined();
    });

    it('starts a server', async () => {
      await expect(percy.start()).resolves.toBeUndefined();
      await expect(fetch('http://localhost:5338')).resolves.toBeDefined();
    });

    it('starts a server after launching a browser and creating a build', async () => {
      let launch = percy.discoverer.launch.bind(percy.discoverer);
      let create = percy.client.createBuild.bind(percy.client);
      let start = percy.server.listen.bind(percy.server);
      let launched, created, started;

      percy.discoverer.launch = () => (launched = Date.now(), launch());
      percy.client.createBuild = () => (created = Date.now(), create());
      percy.server.listen = () => (started = Date.now(), start());

      await expect(percy.start()).resolves.toBeUndefined();

      expect(launched).toBeLessThan(created);
      expect(created).toBeLessThan(started);
    });

    it('does not error or launch multiple browsers', async () => {
      await expect(percy.discoverer.launch()).resolves.toBeUndefined();
      expect(percy.discoverer.isConnected()).toBe(true);
      expect(percy.isRunning()).toBe(false);

      await expect(percy.start()).resolves.toBeUndefined();
      expect(percy.discoverer.isConnected()).toBe(true);
      expect(percy.isRunning()).toBe(true);
    });

    it('logs once started with a loglevel', async () => {
      percy.loglevel('info');
      await stdio.capture(() => percy.start());

      expect(stdio[2]).toHaveLength(0);
      expect(stdio[1]).toEqual([
        '[percy] Percy has started!\n',
        '[percy] Created build #1: https://percy.io/test/test/123\n'
      ]);
    });

    it('does not start when encountering an error', async () => {
      // an api error comes after the server starts and browser launches
      mockAPI.reply('/builds', () => [401, {
        errors: [{ detail: 'build error' }]
      }]);

      await expect(percy.start())
        .rejects.toThrow('build error');

      expect(percy.isRunning()).toBe(false);
      expect(percy.server.listening).toBe(false);
      expect(percy.discoverer.isConnected()).toBe(false);
    });

    it('throws when the port is in use', async () => {
      await expect(percy.start()).resolves.toBeUndefined();
      await expect(Percy.start({ token: 'PERCY_TOKEN' })).rejects
        .toThrow('Percy is already running or the port is in use');
    });

    it('maybe downloads the browser for asset discovery', async function() {
      let local = require('path').join(__dirname, '../.local-chromium');
      let { existsSync } = require('fs');

      this.retries(5); // this flakes on windows due to its non-atomic fs functions
      require('rimraf').sync(local);
      expect(existsSync(local)).toBe(false);
      this.retries(0);

      this.timeout(0); // this might take a minute to download
      await stdio.capture(() => percy.start());
      expect(existsSync(local)).toBe(true);

      expect(stdio[2]).toHaveLength(0);
      expect(stdio[1][0]).toEqual('[percy] Chromium not found, downloading...\n');
      expect(stdio[1][stdio[1].length - 1]).toEqual('[percy] Successfully downloaded Chromium\n');
    });
  });

  describe('#stop()', () => {
    beforeEach(async () => {
      await percy.start();
    });

    it('finalizes the build', async () => {
      await expect(percy.stop()).resolves.toBeUndefined();
      expect(mockAPI.requests['/builds/123/finalize']).toBeDefined();
    });

    it('stops the server', async () => {
      await expect(fetch('http://localhost:5338')).resolves.toBeDefined();
      await expect(percy.stop()).resolves.toBeUndefined();
      expect(percy.server.listening).toBe(false);
    });

    it('closes the browser instance', async () => {
      expect(percy.discoverer.isConnected()).toBe(true);
      await expect(percy.stop()).resolves.toBeUndefined();
      expect(percy.discoverer.isConnected()).toBe(false);
    });

    it('logs when stopping with a loglevel', async () => {
      percy.loglevel('info');
      await stdio.capture(() => percy.stop());

      expect(stdio[2]).toHaveLength(0);
      expect(stdio[1]).toEqual([
        '[percy] Stopping percy...\n',
        '[percy] Finalized build #1: https://percy.io/test/test/123\n',
        '[percy] Done!\n'
      ]);
    });

    it('logs when stopping with pending snapshots', async () => {
      await percy.snapshot({
        name: 'test snapshot',
        url: 'http://localhost:8000',
        domSnapshot: '<html></html>',
        widths: [1000]
      });

      percy.loglevel('info');
      await stdio.capture(() => percy.stop());

      expect(stdio[2]).toHaveLength(0);
      expect(stdio[1]).toEqual([
        '[percy] Stopping percy...\n',
        '[percy] Waiting for 1 snapshot(s) to finish uploading\n',
        '[percy] Finalized build #1: https://percy.io/test/test/123\n',
        '[percy] Done!\n'
      ]);
    });

    it('logs when stopping with pending captures', async () => {
      server = await createTestServer({
        default: () => [200, 'text/html', '<p>Test</p>']
      });

      // not awaited on so it becomes pending
      percy.capture({ name: 'test snapshot', url: 'http://localhost:8000' });

      percy.loglevel('info');
      await stdio.capture(() => percy.stop());

      expect(stdio[2]).toHaveLength(0);
      expect(stdio[1]).toEqual([
        '[percy] Stopping percy...\n',
        '[percy] Waiting for 1 page(s) to finish snapshotting\n',
        '[percy] Snapshot taken: test snapshot\n',
        '[percy] Finalized build #1: https://percy.io/test/test/123\n',
        '[percy] Done!\n'
      ]);
    });

    it('cleans up the server and browser before finalizing', async () => {
      // should cause a throw after browser and server should be closed
      mockAPI.reply('/builds/123/finalize', () => [401, {
        errors: [{ detail: 'finalize error' }]
      }]);

      await expect(percy.stop()).rejects.toThrow('finalize error');
      expect(percy.server.listening).toBe(false);
      expect(percy.discoverer.isConnected()).toBe(false);
    });
  });

  describe('#idle()', () => {
    beforeEach(async () => {
      await percy.start();
    });

    it('resolves after captures idle', async () => {
      server = await createTestServer({
        default: () => [200, 'text/html', '<p>Test</p>']
      });

      // not awaited on so it becomes pending
      percy.capture({ name: 'test snapshot', url: 'http://localhost:8000' });

      percy.loglevel('info');
      await stdio.capture(() => percy.idle());

      expect(stdio[2]).toHaveLength(0);
      expect(stdio[1]).toEqual([
        '[percy] Snapshot taken: test snapshot\n'
      ]);
    });

    it('resolves after snapshots idle', async () => {
      await percy.snapshot({
        name: 'test snapshot',
        url: 'http://localhost:8000',
        domSnapshot: '<html></html>',
        widths: [1000]
      });

      expect(mockAPI.requests['/builds/123/snapshots']).toBeUndefined();

      await percy.idle();

      expect(mockAPI.requests['/builds/123/snapshots']).toHaveLength(1);
    });
  });

  describe('#snapshot()', () => {
    let testDOM = dedent`
      <html>
      <head><link rel="stylesheet" href="style.css"/></head>
      <body><p>Hello Percy!<p><img src="img.gif" decoding="async"/></body>
      </html>
    `;

    let testCSS = dedent`
      p { color: purple; }
    `;

    // http://png-pixel.com/
    let pixel = Buffer.from('R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==', 'base64');

    beforeEach(async () => {
      server = await createTestServer({
        '/': () => [200, 'text/html', testDOM],
        '/style.css': () => [200, 'text/css', testCSS],
        '/img.gif': () => [200, 'image/gif', pixel]
      });

      await percy.start();
    });

    it('creates a new snapshot for the build', async () => {
      await percy.snapshot({
        name: 'test snapshot',
        url: 'http://localhost:8000',
        domSnapshot: testDOM
      });

      await percy.idle();
      expect(mockAPI.requests['/builds/123/snapshots'][0].body).toEqual({
        data: {
          type: 'snapshots',
          attributes: {
            name: 'test snapshot',
            widths: [1000],
            'minimum-height': 1024,
            'enable-javascript': null
          },
          relationships: {
            resources: {
              data: expect.arrayContaining([{
                type: 'resources',
                id: sha256hash(testDOM),
                attributes: {
                  'resource-url': 'http://localhost:8000/',
                  'is-root': true,
                  mimetype: 'text/html'
                }
              }, {
                type: 'resources',
                id: sha256hash(testCSS),
                attributes: {
                  'resource-url': 'http://localhost:8000/style.css',
                  'is-root': null,
                  mimetype: 'text/css'
                }
              }, {
                type: 'resources',
                id: sha256hash(pixel),
                attributes: {
                  'resource-url': 'http://localhost:8000/img.gif',
                  'is-root': null,
                  mimetype: 'image/gif'
                }
              }, {
                type: 'resources',
                id: expect.any(String),
                attributes: {
                  'resource-url': expect.stringMatching(/^\/percy\.\d+\.log$/),
                  'is-root': null,
                  mimetype: 'text/plain'
                }
              }])
            }
          }
        }
      });
    });

    it('uploads missing resources for the snapshot', async () => {
      await percy.snapshot({
        name: 'test snapshot',
        url: 'http://localhost:8000',
        domSnapshot: testDOM
      });

      await percy.idle();
      expect(mockAPI.requests['/builds/123/resources']).toHaveLength(4);
      expect(mockAPI.requests['/builds/123/resources'].map(r => r.body)).toEqual(
        expect.arrayContaining([{
          data: {
            type: 'resources',
            id: sha256hash(testDOM),
            attributes: {
              'base64-content': base64encode(testDOM)
            }
          }
        }, {
          data: {
            type: 'resources',
            id: sha256hash(testCSS),
            attributes: {
              'base64-content': base64encode(testCSS)
            }
          }
        }, {
          data: {
            type: 'resources',
            id: sha256hash(pixel),
            attributes: {
              'base64-content': base64encode(pixel)
            }
          }
        }, {
          data: {
            type: 'resources',
            id: mockAPI.requests['/builds/123/snapshots'][0]
              .body.data.relationships.resources.data[3].id,
            attributes: {
              'base64-content': expect.any(String)
            }
          }
        }])
      );
    });

    it('finalizes the snapshot', async () => {
      await percy.snapshot({
        name: 'test snapshot',
        url: 'http://localhost:8000',
        domSnapshot: testDOM
      });

      await percy.idle();
      expect(mockAPI.requests['/snapshots/4567/finalize']).toBeDefined();
    });

    it('throws an error when missing required arguments', () => {
      expect(() => percy.snapshot({ url: 'test' }))
        .toThrow('Missing required argument: name');
      expect(() => percy.snapshot({ name: 'test' }))
        .toThrow('Missing required argument: url');
      expect(() => percy.snapshot({ name: 'test', url: 'test' }))
        .toThrow('Missing required argument: domSnapshot');
    });

    it('throws when not running', async () => {
      await percy.stop();
      expect(() => percy.snapshot({})).toThrow('Not running');
    });

    it('logs after taking the snapshot with a loglevel', async () => {
      percy.loglevel('info');
      await stdio.capture(() => (
        percy.snapshot({
          name: 'test snapshot',
          url: 'http://localhost:8000',
          domSnapshot: testDOM
        })
      ));

      expect(stdio[2]).toHaveLength(0);
      expect(stdio[1]).toEqual([
        '[percy] Snapshot taken: test snapshot\n'
      ]);
    });

    it('logs any encountered errors when snapshotting', async () => {
      await stdio.capture(() => (
        percy.snapshot({
          name: 'test snapshot',
          url: 'http://localhost:8000',
          domSnapshot: testDOM,
          // sabatoge an array to cause an unexpected error
          widths: Object.assign([1000], {
            map: () => { throw new Error('snapshot error'); }
          })
        })
      ));

      expect(stdio[1]).toHaveLength(0);
      expect(stdio[2]).toEqual([
        '[percy] Encountered an error taking snapshot: test snapshot\n',
        '[percy] Error: snapshot error\n'
      ]);
    });

    it('logs any encountered errors when uploading', async () => {
      mockAPI.reply('/builds/123/snapshots', () => [401, {
        errors: [{ detail: 'snapshot upload error' }]
      }]);

      await percy.snapshot({
        name: 'test snapshot',
        url: 'http://localhost:8000',
        domSnapshot: testDOM
      });

      await stdio.capture(() => (
        percy.idle()
      ));

      expect(stdio[1]).toHaveLength(0);
      expect(stdio[2]).toEqual([
        '[percy] Encountered an error uploading snapshot: test snapshot\n',
        '[percy] Error: snapshot upload error\n'
      ]);
    });
  });
});
