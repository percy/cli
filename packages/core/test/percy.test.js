import fetch from 'node-fetch';
import Percy from '../src';
import { mockAPI, logger, createTestServer, dedent } from './helpers';
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
    await percy.stop();
    await server?.close();
  });

  it('scrubs invalid config options and loads defaults', () => {
    percy = new Percy({ snapshot: { foo: 'bar' } });

    expect(percy.config.snapshot).toEqual({
      widths: [375, 1280],
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
      expect(percy.loglevel()).toBe('info');
    });

    it('returns the specified loglevel', () => {
      percy = new Percy({ loglevel: 'warn' });
      expect(percy.loglevel()).toBe('warn');
    });

    it('sets the loglevel', () => {
      expect(percy.loglevel()).toBe('info');
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
      await expectAsync(percy.start()).toBeResolved();
      expect(percy.discoverer.isConnected()).toBe(true);
    });

    it('creates a build', async () => {
      await expectAsync(percy.start()).toBeResolved();
      expect(mockAPI.requests['/builds']).toBeDefined();
    });

    it('starts a server', async () => {
      await expectAsync(percy.start()).toBeResolved();
      await expectAsync(fetch('http://localhost:5338')).toBeResolved();
    });

    it('starts a server after launching a browser and creating a build', async () => {
      spyOn(percy.discoverer, 'launch').and.callThrough();
      spyOn(percy.client, 'createBuild').and.callThrough();
      spyOn(percy.server, 'listen').and.callThrough();

      await expectAsync(percy.start()).toBeResolved();

      expect(percy.discoverer.launch)
        .toHaveBeenCalledBefore(percy.client.createBuild);
      expect(percy.client.createBuild)
        .toHaveBeenCalledBefore(percy.server.listen);
    });

    it('does not error or launch multiple browsers', async () => {
      await expectAsync(percy.discoverer.launch()).toBeResolved();
      expect(percy.discoverer.isConnected()).toBe(true);
      expect(percy.isRunning()).toBe(false);

      await expectAsync(percy.start()).toBeResolved();
      expect(percy.discoverer.isConnected()).toBe(true);
      expect(percy.isRunning()).toBe(true);
    });

    it('logs once started', async () => {
      await percy.start();

      expect(logger.stderr).toEqual([]);
      expect(logger.stdout).toEqual([
        '[percy] Percy has started!',
        '[percy] Created build #1: https://percy.io/test/test/123'
      ]);
    });

    it('does not start when encountering an error', async () => {
      // an api error comes after the server starts and browser launches
      mockAPI.reply('/builds', () => [401, {
        errors: [{ detail: 'build error' }]
      }]);

      await expectAsync(percy.start()).toBeRejectedWithError('build error');

      expect(percy.isRunning()).toBe(false);
      expect(percy.server.listening).toBe(false);
      expect(percy.discoverer.isConnected()).toBe(false);
    });

    it('throws when the port is in use', async () => {
      await expectAsync(percy.start()).toBeResolved();
      await expectAsync(Percy.start({ token: 'PERCY_TOKEN' }))
        .toBeRejectedWithError('Percy is already running or the port is in use');
    });
  });

  describe('#stop()', () => {
    beforeEach(async () => {
      await percy.start();
      logger.reset();
    });

    it('finalizes the build', async () => {
      await expectAsync(percy.stop()).toBeResolved();
      expect(mockAPI.requests['/builds/123/finalize']).toBeDefined();
    });

    it('stops the server', async () => {
      await expectAsync(fetch('http://localhost:5338')).toBeResolved();
      await expectAsync(percy.stop()).toBeResolved();
      expect(percy.server.listening).toBe(false);
    });

    it('closes the browser instance', async () => {
      expect(percy.discoverer.isConnected()).toBe(true);
      await expectAsync(percy.stop()).toBeResolved();
      expect(percy.discoverer.isConnected()).toBe(false);
    });

    it('logs when stopping', async () => {
      await percy.stop();

      expect(logger.stderr).toEqual([]);
      expect(logger.stdout).toEqual([
        '[percy] Stopping percy...',
        '[percy] Finalized build #1: https://percy.io/test/test/123',
        '[percy] Done!'
      ]);
    });

    it('logs when stopping with pending snapshots', async () => {
      await percy.snapshot({
        name: 'test snapshot',
        url: 'http://localhost:8000',
        domSnapshot: '<html></html>',
        widths: [1000]
      });

      await percy.stop();

      expect(logger.stderr).toEqual([]);
      expect(logger.stdout).toEqual([
        '[percy] Snapshot taken: test snapshot',
        '[percy] Stopping percy...',
        '[percy] Waiting for 1 snapshot(s) to finish uploading',
        '[percy] Finalized build #1: https://percy.io/test/test/123',
        '[percy] Done!'
      ]);
    });

    it('logs when stopping with pending captures', async () => {
      server = await createTestServer({
        default: () => [200, 'text/html', '<p>Test</p>']
      });

      // not awaited on so it becomes pending
      percy.capture({ name: 'test snapshot', url: 'http://localhost:8000' });
      await percy.stop();

      expect(logger.stderr).toEqual([]);
      expect(logger.stdout).toEqual([
        '[percy] Stopping percy...',
        '[percy] Waiting for 1 page(s) to finish snapshotting',
        '[percy] Snapshot taken: test snapshot',
        '[percy] Finalized build #1: https://percy.io/test/test/123',
        '[percy] Done!'
      ]);
    });

    it('cleans up the server and browser before finalizing', async () => {
      // should cause a throw after browser and server should be closed
      mockAPI.reply('/builds/123/finalize', () => [401, {
        errors: [{ detail: 'finalize error' }]
      }]);

      await expectAsync(percy.stop()).toBeRejectedWithError('finalize error');
      expect(percy.server.listening).toBe(false);
      expect(percy.discoverer.isConnected()).toBe(false);
    });
  });

  describe('#idle()', () => {
    beforeEach(async () => {
      await percy.start();
      logger.reset();
    });

    it('resolves after captures idle', async () => {
      server = await createTestServer({
        default: () => [200, 'text/html', '<p>Test</p>']
      });

      // not awaited on so it becomes pending
      percy.capture({ name: 'test snapshot', url: 'http://localhost:8000' });
      await percy.idle();

      expect(logger.stderr).toEqual([]);
      expect(logger.stdout).toEqual([
        '[percy] Snapshot taken: test snapshot'
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

      expect(mockAPI.requests['/builds/123/snapshots']).toHaveSize(1);
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
        '/img.gif': () => [200, 'image/gif', pixel],
        '/auth/img.gif': ({ headers: { authorization } }) => {
          if (authorization === 'Basic dGVzdDo=') {
            return [200, 'image/gif', pixel];
          } else {
            return [401, {
              'WWW-Authenticate': 'Basic',
              'Content-Type': 'text/plain'
            }, '401 Unauthorized'];
          }
        }
      });

      await percy.start();
      logger.reset();
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
              data: jasmine.arrayContaining([{
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
                id: jasmine.any(String),
                attributes: {
                  'resource-url': jasmine.stringMatching(/^\/percy\.\d+\.log$/),
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
      expect(mockAPI.requests['/builds/123/resources']).toHaveSize(4);
      expect(mockAPI.requests['/builds/123/resources'].map(r => r.body)).toEqual(
        jasmine.arrayContaining([{
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
              'base64-content': jasmine.any(String)
            }
          }
        }])
      );
    });

    it('does not upload protected assets', async () => {
      let domSnapshot = testDOM.replace('img.gif', 'auth/img.gif');

      await percy.snapshot({
        name: 'auth snapshot',
        url: 'http://localhost:8000/auth',
        domSnapshot
      });

      await percy.idle();

      expect(mockAPI.requests['/builds/123/resources'].map(r => r.body))
        .not.toEqual(jasmine.arrayContaining([{
          data: {
            type: 'resources',
            id: sha256hash(pixel),
            attributes: {
              'base64-content': base64encode(pixel)
            }
          }
        }]));
    });

    it('uploads protected assets with valid auth credentials', async () => {
      let domSnapshot = testDOM.replace('img.gif', 'auth/img.gif');

      await percy.snapshot({
        name: 'auth snapshot',
        url: 'http://localhost:8000/auth',
        authorization: { username: 'test' },
        domSnapshot
      });

      await percy.idle();

      expect(mockAPI.requests['/builds/123/resources'].map(r => r.body))
        .toEqual(jasmine.arrayContaining([{
          data: {
            type: 'resources',
            id: sha256hash(pixel),
            attributes: {
              'base64-content': base64encode(pixel)
            }
          }
        }]));
    });

    it('does not upload protected assets with invalid auth credentials', async () => {
      let domSnapshot = testDOM.replace('img.gif', 'auth/img.gif');

      await percy.snapshot({
        name: 'auth snapshot',
        url: 'http://localhost:8000/auth',
        authorization: { username: 'invalid' },
        domSnapshot
      });

      await percy.idle();

      expect(mockAPI.requests['/builds/123/resources'].map(r => r.body))
        .not.toEqual(jasmine.arrayContaining([{
          data: {
            type: 'resources',
            id: sha256hash(pixel),
            attributes: {
              'base64-content': base64encode(pixel)
            }
          }
        }]));
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
        .toThrowError('Missing required argument: name');
      expect(() => percy.snapshot({ name: 'test' }))
        .toThrowError('Missing required argument: url');
      expect(() => percy.snapshot({ name: 'test', url: 'test' }))
        .toThrowError('Missing required argument: domSnapshot');
    });

    it('throws when not running', async () => {
      await percy.stop();
      expect(() => percy.snapshot({})).toThrowError('Not running');
    });

    it('logs after taking the snapshot', async () => {
      await percy.snapshot({
        name: 'test snapshot',
        url: 'http://localhost:8000',
        domSnapshot: testDOM
      });

      expect(logger.stderr).toEqual([]);
      expect(logger.stdout).toEqual([
        '[percy] Snapshot taken: test snapshot'
      ]);
    });

    it('logs any encountered errors when snapshotting', async () => {
      await percy.snapshot({
        name: 'test snapshot',
        url: 'http://localhost:8000',
        domSnapshot: testDOM,
        // sabatoge an array to cause an unexpected error
        widths: Object.assign([1000], {
          map: () => { throw new Error('snapshot error'); }
        })
      });

      expect(logger.stdout).toEqual([]);
      expect(logger.stderr).toEqual([
        '[percy] Encountered an error taking snapshot: test snapshot',
        '[percy] Error: snapshot error'
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

      logger.reset();
      await percy.idle();

      expect(logger.stdout).toEqual([]);
      expect(logger.stderr).toEqual([
        '[percy] Encountered an error uploading snapshot: test snapshot',
        '[percy] Error: snapshot upload error'
      ]);
    });
  });
});
