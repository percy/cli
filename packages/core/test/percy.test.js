import fetch from 'node-fetch';
import Percy from '../src';
import { mockAPI, logger, createTestServer } from './helpers';

describe('Percy', () => {
  let percy, server;

  beforeEach(async () => {
    server = await createTestServer({
      default: () => [200, 'text/html', '<p>Snapshot</p>']
    });

    percy = new Percy({
      token: 'PERCY_TOKEN',
      snapshot: { widths: [1000] },
      discovery: { concurrency: 1 },
      clientInfo: 'client-info',
      environmentInfo: 'env-info'
    });
  });

  afterEach(async () => {
    await percy.stop();
    await server.close();
  });

  it('logs when a snapshot is missing env info', async () => {
    percy = new Percy({
      token: 'PERCY_TOKEN',
      snapshot: { widths: [1000] },
      discovery: { concurrency: 1 }
    });

    await percy.start();
    await percy.snapshot({
      name: 'test snapshot',
      url: 'http://localhost:8000',
      domSnapshot: '<html></html>'
    });

    await expectAsync(percy.stop()).toBeResolved();
    expect(logger.stderr).toEqual(['[percy] Warning: Missing `clientInfo` and/or `environmentInfo` properties']);
    expect(logger.stdout).toEqual(jasmine.arrayContaining([
      '[percy] Percy has started!',
      '[percy] Snapshot taken: test snapshot'
    ]));
  });

  it('scrubs invalid config options and loads defaults', () => {
    percy = new Percy({ snapshot: { foo: 'bar' } });

    expect(percy.config.snapshot).toEqual({
      widths: [375, 1280],
      minHeight: 1024,
      percyCSS: ''
    });
  });

  it('allows access to create browser pages for other SDKs', async () => {
    // add a request that fails for coverage when requests aren't intercepted
    let img = '<img src="http://localhost:9000/404.png">';
    server.reply('/', () => [200, 'text/html', `<p>Hello Percy!</p>${img}`]);

    // start the browser and get a page without using percy methods
    await percy.browser.launch();
    let page = await percy.browser.page();

    // navigate to a page and capture a snapshot outside of core
    await page.goto('http://localhost:8000');

    let { url, dom } = await page.snapshot({
      execute() {
        let p = document.querySelector('p');
        p.textContent = p.textContent.replace('Hello', 'Hello there,');
      }
    });

    expect(url).toEqual('http://localhost:8000/');
    expect(dom).toEqual('<!DOCTYPE html><html><head></head><body>' + (
      `<p>Hello there, Percy!</p>${img}`
    ) + '</body></html>');
  });

  describe('.start()', () => {
    // rather than stub prototypes, extend and mock
    class TestPercy extends Percy {
      constructor(...args) {
        super(...args);
        this.test = { new: args };
        this.start = () => (this.test.started = true);
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

  describe('#address()', () => {
    it('returns the server API address', async () => {
      expect(percy.address()).toEqual('http://localhost:5338');
    });
  });

  describe('#setConfig(config)', () => {
    it('adds client and environment information', () => {
      expect(percy.setConfig({
        clientInfo: 'client/info',
        environmentInfo: 'env/info'
      })).toEqual(percy.config);

      expect(percy.client.clientInfo).toContain('client/info');
      expect(percy.client.environmentInfo).toContain('env/info');
    });

    it('merges existing and provided config options', () => {
      expect(percy.setConfig({
        snapshot: { widths: [1000] }
      })).toEqual({
        ...percy.config,
        snapshot: {
          ...percy.config.snapshot,
          widths: [1000]
        }
      });
    });

    it('warns and ignores invalid config options', () => {
      expect(percy.setConfig({
        snapshot: { widths: 1000 },
        foo: 'bar'
      })).toEqual(percy.config);

      expect(logger.stderr).toEqual([
        '[percy] Invalid config:',
        '[percy] - foo: unknown property',
        '[percy] - snapshot.widths: must be an array, received a number'
      ]);
    });
  });

  describe('#start()', () => {
    it('creates a new build', async () => {
      await expectAsync(percy.start()).toBeResolved();
      expect(mockAPI.requests['/builds']).toBeDefined();
    });

    it('launches a browser after creating a new build', async () => {
      spyOn(percy.client, 'createBuild').and.callThrough();
      spyOn(percy.browser, 'launch').and.callThrough();

      await expectAsync(percy.start()).toBeResolved();
      expect(percy.browser.isConnected()).toBe(true);

      expect(percy.client.createBuild)
        .toHaveBeenCalledBefore(percy.browser.launch);
    });

    it('starts a server after launching a browser', async () => {
      spyOn(percy.browser, 'launch').and.callThrough();
      spyOn(percy.server, 'listen').and.callThrough();

      await expectAsync(percy.start()).toBeResolved();
      await expectAsync(fetch('http://localhost:5338')).toBeResolved();

      expect(percy.browser.launch)
        .toHaveBeenCalledBefore(percy.server.listen);
    });

    it('logs once started', async () => {
      await expectAsync(percy.start()).toBeResolved();

      expect(logger.stderr).toEqual([]);
      expect(logger.stdout).toEqual([
        '[percy] Percy has started!'
      ]);
    });

    it('does not start multiple times', async () => {
      spyOn(percy.client, 'createBuild').and.callThrough();
      spyOn(percy.browser, 'launch').and.callThrough();
      spyOn(percy.server, 'listen').and.callThrough();

      await expectAsync(percy.start()).toBeResolved();
      await expectAsync(percy.start()).toBeResolved();

      expect(percy.client.createBuild).toHaveBeenCalledTimes(1);
      expect(percy.browser.launch).toHaveBeenCalledTimes(1);
      expect(percy.server.listen).toHaveBeenCalledTimes(1);

      expect(logger.stderr).toEqual([]);
      expect(logger.stdout).toEqual([
        '[percy] Percy has started!'
      ]);
    });

    it('does not error when the browser has already launched', async () => {
      await expectAsync(percy.browser.launch()).toBeResolved();
      await percy.browser.page().then(p => p.close());
      expect(percy.browser.isConnected()).toBe(true);
      expect(percy.readyState).toBeNull();

      await expectAsync(percy.start()).toBeResolved();
      expect(percy.browser.isConnected()).toBe(true);
      expect(percy.readyState).toEqual(1);
    });

    it('does not start when encountering an error', async () => {
      mockAPI.reply('/builds', () => [401, {
        errors: [{ detail: 'build error' }]
      }]);

      await expectAsync(percy.start()).toBeRejectedWithError('build error');

      expect(percy.readyState).toEqual(3);
      expect(percy.server.listening).toBe(false);
      expect(percy.browser.isConnected()).toBe(false);
    });

    it('throws when the port is in use', async () => {
      await expectAsync(percy.start()).toBeResolved();
      await expectAsync(Percy.start({ token: 'PERCY_TOKEN' }))
        .toBeRejectedWithError('Percy is already running or the port is in use');
    });

    it('queues build creation when uploads are deferred', async () => {
      percy = new Percy({ token: 'PERCY_TOKEN', deferUploads: true });
      await expectAsync(percy.start()).toBeResolved();
      expect(mockAPI.requests['/builds']).toBeUndefined();

      // process deferred uploads
      percy.snapshot({ url: 'http://localhost:8000' });
      await percy.flush();

      expect(mockAPI.requests['/builds']).toBeDefined();
    });

    it('cancels deferred build creation when interupted', async () => {
      percy = new Percy({ token: 'PERCY_TOKEN', deferUploads: true });

      // fake these methods to make this test more reliable
      let sleep = ms => new Promise(r => setTimeout(r, ms));
      spyOn(percy.browser, 'launch').and.callFake(() => sleep(10));
      spyOn(percy.server, 'listen').and.callFake(() => sleep(500));

      // #start returns a promise-like generator
      let starting = percy.start();
      let started = starting.then();

      // wait until server.listen is called but before it finishes
      await sleep(200);
      // cancel the underlying generator
      starting.cancel();

      await expectAsync(started).toBeRejected();
      expect(percy.readyState).toEqual(null);

      // processing deferred uploads should not result in a new build
      await percy.flush();
      expect(mockAPI.requests['/builds']).toBeUndefined();

      // start without canceling to verify it still works
      await percy.start();

      // take a snapshot for
      percy.snapshot({ url: 'http://localhost:8000' });
      await percy.flush();

      expect(mockAPI.requests['/builds']).toBeDefined();
      expect(percy.readyState).toEqual(1);
    });

    it('does not create a build when uploads are skipped', async () => {
      percy = new Percy({ token: 'PERCY_TOKEN', skipUploads: true });
      await expectAsync(percy.start()).toBeResolved();
      expect(mockAPI.requests['/builds']).toBeUndefined();

      // process deferred uploads
      await percy.flush();

      expect(mockAPI.requests['/builds']).toBeUndefined();

      // stopping should also skip uploads
      await percy.stop();

      expect(mockAPI.requests['/builds']).toBeUndefined();

      expect(logger.stderr).toEqual([
        '[percy] Build not created'
      ]);
    });

    it('does not launch the browser and skips uploads when dry-running', async () => {
      percy = new Percy({ token: 'PERCY_TOKEN', dryRun: true });
      await expectAsync(percy.start()).toBeResolved();
      expect(percy.browser.isConnected()).toBe(false);
      expect(mockAPI.requests['/builds']).toBeUndefined();

      await percy.stop();

      expect(mockAPI.requests['/builds']).toBeUndefined();

      expect(logger.stderr).toEqual([
        '[percy] Build not created'
      ]);
    });

    it('stops accepting snapshots when a queued build fails to be created', async () => {
      mockAPI.reply('/builds', () => [401, {
        errors: [{ detail: 'build error' }]
      }]);

      percy = new Percy({ token: 'PERCY_TOKEN', deferUploads: true });
      await expectAsync(percy.start()).toBeResolved();

      await expectAsync(percy.snapshot({
        name: 'Snapshot 1',
        url: 'http://localhost:8000'
      })).toBeResolved();

      expect(mockAPI.requests['/builds']).toBeUndefined();
      expect(mockAPI.requests['/builds/123/snapshots']).toBeUndefined();

      // process deferred uploads
      await percy.flush();

      expect(mockAPI.requests['/builds']).toBeDefined();
      expect(mockAPI.requests['/builds/123/snapshots']).toBeUndefined();

      // throws synchronously
      expect(() => percy.snapshot({
        name: 'Snapshot 2',
        url: 'http://localhost:8000'
      })).toThrowError('Closed');

      expect(logger.stdout).toEqual([
        '[percy] Percy has started!',
        '[percy] Snapshot taken: Snapshot 1'
      ]);
      expect(logger.stderr).toEqual([
        '[percy] Failed to create build',
        '[percy] Error: build error'
      ]);
    });
  });

  describe('#stop()', () => {
    // stop the previously started instance and clear requests
    async function reset(options) {
      await percy.stop().then(() => logger.reset());
      Object.keys(mockAPI.requests).map(k => delete mockAPI.requests[k]);
      percy = await Percy.start({ token: 'PERCY_TOKEN', ...options });
    }

    beforeEach(async () => {
      await percy.start();
    });

    it('finalizes the build', async () => {
      await expectAsync(percy.stop()).toBeResolved();
      expect(mockAPI.requests['/builds/123/finalize']).toBeDefined();

      expect(logger.stderr).toEqual([]);
      expect(logger.stdout).toContain(
        '[percy] Finalized build #1: https://percy.io/test/test/123'
      );
    });

    it('stops the server', async () => {
      await expectAsync(fetch('http://localhost:5338')).toBeResolved();
      await expectAsync(percy.stop()).toBeResolved();
      expect(percy.server.listening).toBe(false);
    });

    it('closes the browser instance', async () => {
      expect(percy.browser.isConnected()).toBe(true);
      await expectAsync(percy.stop()).toBeResolved();
      expect(percy.browser.isConnected()).toBe(false);
    });

    it('clears pending tasks and logs when force stopping', async () => {
      await reset({ deferUploads: true });
      await expectAsync(percy.stop(true)).toBeResolved();

      // no build should be created or finalized
      expect(mockAPI.requests['/builds']).toBeUndefined();
      expect(mockAPI.requests['/builds/123/finalize']).toBeUndefined();

      expect(logger.stdout).toContain(
        '[percy] Stopping percy...'
      );
      expect(logger.stderr).toEqual([
        '[percy] Build not created'
      ]);
    });

    it('logs when stopping with pending snapshots', async () => {
      // don't wait for the snapshot so we can see the right log
      percy.snapshot({
        name: 'test snapshot',
        url: 'http://localhost:8000',
        domSnapshot: '<html></html>'
      });

      await expectAsync(percy.stop()).toBeResolved();

      expect(logger.stderr).toEqual([]);
      expect(logger.stdout).toEqual(jasmine.arrayContaining([
        '[percy] Processing 1 snapshot...',
        '[percy] Snapshot taken: test snapshot',
        '[percy] Finalized build #1: https://percy.io/test/test/123'
      ]));
    });

    it('logs the total number of snapshots when dry-running', async () => {
      await reset({ dryRun: true });

      percy.snapshot({ url: 'http://localhost:8000/one' });
      percy.snapshot({ url: 'http://localhost:8000/two' });
      percy.snapshot({ url: 'http://localhost:8000/three' });

      await expectAsync(percy.stop()).toBeResolved();

      expect(logger.stdout).toEqual(jasmine.arrayContaining([
        '[percy] Snapshot found: /one',
        '[percy] Snapshot found: /two',
        '[percy] Snapshot found: /three',
        '[percy] Found 3 snapshots'
      ]));
      expect(logger.stderr).toEqual([
        '[percy] Build not created'
      ]);
    });

    it('cleans up the server and browser before finalizing', async () => {
      mockAPI.reply('/builds/123/finalize', () => [401, {
        errors: [{ detail: 'finalize error' }]
      }]);

      await expectAsync(percy.stop()).toBeRejectedWithError('finalize error');
      expect(percy.server.listening).toBe(false);
      expect(percy.browser.isConnected()).toBe(false);
    });

    it('does not clean up if canceled while waiting on pending tasks', async () => {
      let snapshots = [
        percy.snapshot({ url: 'http://localhost:8000/one' }),
        percy.snapshot({ url: 'http://localhost:8000/two' }),
        percy.snapshot({ url: 'http://localhost:8000/three' })
      ];

      // #stop returns a promise-like generator
      let stopping = percy.stop();
      let stopped = stopping.then();

      // wait until the first snapshot is done before canceling
      await snapshots[0];
      stopping.cancel();

      await expectAsync(stopped).toBeRejected();
      expect(percy.readyState).toEqual(1);
      expect(percy.server.listening).toBe(true);
      expect(percy.browser.isConnected()).toBe(true);
      expect(mockAPI.requests['/builds/123/finalize']).toBeUndefined();

      expect(logger.stdout).toEqual([
        '[percy] Percy has started!',
        '[percy] Processing 3 snapshots...',
        '[percy] Snapshot taken: /one'
      ]);

      // stop without canceling to verify it still works
      await percy.stop();

      expect(percy.readyState).toEqual(3);
      expect(percy.server.listening).toBe(false);
      expect(percy.browser.isConnected()).toBe(false);
      expect(mockAPI.requests['/builds/123/finalize']).toBeDefined();

      expect(logger.stdout).toEqual(jasmine.arrayContaining([
        '[percy] Snapshot taken: /two',
        '[percy] Snapshot taken: /three'
      ]));
    });

    it('does not error if the browser was never launched', async () => {
      await reset({ dryRun: true });

      percy.snapshot({ url: 'http://localhost:8000' });

      expect(percy.browser.isConnected()).toBe(false);
      await expectAsync(percy.stop()).toBeResolved();
      expect(percy.browser.isConnected()).toBe(false);

      expect(logger.stdout).toEqual(jasmine.arrayContaining([
        '[percy] Found 1 snapshot'
      ]));
      expect(logger.stderr).toEqual([
        '[percy] Build not created'
      ]);
    });

    it('logs when the build has failed upstream', async () => {
      mockAPI.reply('/builds/123/snapshots', () => [422, {
        errors: [
          { detail: 'Cannot create snapshot in failed builds' },
          { detail: 'Build has failed', source: { pointer: '/data/attributes/build' } }
        ]
      }]);

      // does not fail on upstream errors
      await percy.snapshot({
        name: 'test snapshot',
        url: 'http://localhost:8000',
        domSnapshot: '<html></html>'
      });

      await expectAsync(percy.stop()).toBeResolved();

      expect(logger.stdout).toEqual(jasmine.arrayContaining([
        '[percy] Snapshot taken: test snapshot'
      ]));
      expect(logger.stderr).toEqual([
        '[percy] Encountered an error uploading snapshot: test snapshot',
        '[percy] Build has failed',
        '[percy] Build #1 failed: https://percy.io/test/test/123'
      ]);
    });
  });

  describe('#idle()', () => {
    beforeEach(async () => {
      await percy.start();
      logger.reset();
    });

    it('resolves after snapshots idle', async () => {
      percy.snapshot({
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

  describe('#capture()', () => {
    it('is deprecated', async () => {
      spyOn(percy, 'snapshot').and.resolveTo('fin');
      await expectAsync(percy.capture()).toBeResolvedTo('fin');
      expect(percy.snapshot).toHaveBeenCalledTimes(1);

      expect(logger.stderr).toEqual([
        '[percy] Warning: The #capture() method will be ' +
          'removed in 1.0.0. Use #snapshot() instead.'
      ]);
    });
  });
});
