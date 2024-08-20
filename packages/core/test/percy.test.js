import { logger, api, setupTest, createTestServer } from './helpers/index.js';
import { generatePromise, AbortController, base64encode } from '../src/utils.js';
import Percy from '@percy/core';
import Pako from 'pako';
import DetectProxy from '@percy/client/detect-proxy';

describe('Percy', () => {
  let percy, server;

  beforeEach(async () => {
    await setupTest();

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
    process.env.PERCY_CLIENT_ERROR_LOGS = false;
  });

  afterEach(async () => {
    await percy.stop();
    await server.close();
    delete process.env.PERCY_TOKEN;
    delete process.env.PERCY_CLIENT_ERROR_LOGS;
  });

  const sharedExpectBlockForSuggestion = (expectedBody) => {
    let lastReq = api.requests['/suggestions/from_logs'].length - 1;
    expect(api.requests['/suggestions/from_logs'][lastReq].body)
      .toEqual(expectedBody);
  };

  it('loads config and intializes client with config', () => {
    expect(percy.client.config).toEqual(percy.config);
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
    expect(logger.stderr).toEqual(jasmine.arrayContaining([
      '[percy] Warning: Missing `clientInfo` and/or `environmentInfo` properties'
    ]));
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
      percyCSS: '',
      enableJavaScript: false,
      disableShadowDOM: false,
      cliEnableJavaScript: true
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

    let evalSpy = spyOn(page, 'eval').and.callThrough();

    let snapshot = await page.snapshot({
      execute() {
        let p = document.querySelector('p');
        p.textContent = p.textContent.replace('Hello', 'Hello there,');
      },
      disableShadowDOM: true
    });

    // expect required arguments are passed to PercyDOM.serialize
    expect(evalSpy.calls.allArgs()[3]).toEqual(jasmine.arrayContaining([jasmine.anything(), { enableJavaScript: undefined, disableShadowDOM: true, domTransformation: undefined, reshuffleInvalidTags: undefined }]));

    expect(snapshot.url).toEqual('http://localhost:8000/');
    expect(snapshot.domSnapshot).toEqual(jasmine.objectContaining({
      html: '<!DOCTYPE html><html><head></head><body>' + (
        `<p>Hello there, Percy!</p>${img}`
      ) + '</body></html>'
    }));
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

  describe('#set(config)', () => {
    it('adds client and environment information', () => {
      expect(percy.set({
        clientInfo: 'client/info',
        environmentInfo: 'env/info'
      })).toEqual(percy.config);

      expect(percy.client.clientInfo).toContain('client/info');
      expect(percy.client.environmentInfo).toContain('env/info');
    });

    it('merges existing and provided config options', () => {
      expect(percy.set({
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
      expect(percy.set({
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
      expect(api.requests['/builds']).toBeDefined();
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
      let { request } = await import('./helpers/request.js');
      spyOn(percy.browser, 'launch').and.callThrough();
      spyOn(percy.server, 'listen').and.callThrough();

      await expectAsync(percy.start()).toBeResolved();
      await expectAsync(request('http://localhost:5338', false)).toBeResolved();

      expect(percy.browser.launch)
        .toHaveBeenCalledBefore(percy.server.listen);
    });

    it('logs once started', async () => {
      process.env.PERCY_CLIENT_ERROR_LOGS = true;
      await expectAsync(percy.start()).toBeResolved();

      expect(logger.stderr).toEqual([
        '[percy] Notice: Percy collects CI logs to improve service and enhance your experience. These logs help us debug issues and provide insights on your dashboards, making it easier to optimize the product experience. Logs are stored securely for 30 days. You can opt out anytime with export PERCY_CLIENT_ERROR_LOGS=false, but keeping this enabled helps us offer the best support and features.'
      ]);
      expect(logger.stdout).toEqual([
        '[percy] Percy has started!'
      ]);
    });

    it('should not log CI log collection warning if PERCY_CLIENT_ERROR_LOGS is set false', async () => {
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
      expect(percy.browser.isConnected()).toBe(true);
      expect(percy.readyState).toBeNull();

      await expectAsync(percy.start()).toBeResolved();
      expect(percy.browser.isConnected()).toBe(true);
      expect(percy.readyState).toEqual(1);
    });

    it('does not start when encountering an error', async () => {
      api.reply('/builds', () => [401, {
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
        .toBeRejectedWithError('Percy is already running or the port 5338 is in use');

      sharedExpectBlockForSuggestion({
        data: {
          logs: [
            {
              message: 'Percy is already running or the port 5338 is in use'
            }
          ]
        }
      });
    });

    it('queues build creation when uploads are deferred', async () => {
      percy = new Percy({ token: 'PERCY_TOKEN', deferUploads: true });
      await expectAsync(percy.start()).toBeResolved();
      expect(api.requests['/builds']).toBeUndefined();

      // process deferred uploads
      percy.snapshot('http://localhost:8000');
      await percy.flush();

      expect(api.requests['/builds']).toBeDefined();
    });

    it('validates labels is getting assigned to percy client', async () => {
      percy = new Percy({ token: 'PERCY_TOKEN', labels: 'dev,prod', percy: { labels: 'dev,prod,canary' } });
      expect(percy.client.labels).toEqual('dev,prod');
    });

    it('validates config-labels is getting assigned to percy client', async () => {
      percy = new Percy({ token: 'PERCY_TOKEN', percy: { labels: 'dev,prod,canary' } });
      expect(percy.client.labels).toEqual('dev,prod,canary');
    });

    it('cancels deferred build creation when interupted', async () => {
      percy = new Percy({ token: 'PERCY_TOKEN', deferUploads: true });

      // abort when the browser is launched
      let ctrl = new AbortController();
      spyOn(percy.browser, 'launch').and.callFake(() => ctrl.abort());

      // #yield.start returns a generator that can be aborted
      await expectAsync(generatePromise(percy.yield.start(), ctrl.signal))
        .toBeRejectedWithError('This operation was aborted');
      expect(percy.readyState).toEqual(null);

      // processing deferred uploads should not result in a new build
      await percy.flush();
      expect(api.requests['/builds']).toBeUndefined();
      sharedExpectBlockForSuggestion({
        data: {
          logs: [
            { message: 'This operation was aborted' }
          ]
        }
      });
    });

    it('has projectType', async () => {
      percy = new Percy({ token: 'PERCY_TOKEN', projectType: 'web' });

      // abort when the browser is launched
      let ctrl = new AbortController();
      spyOn(percy.browser, 'launch');

      await generatePromise(percy.yield.start(), ctrl.signal);
      expect(percy.projectType).toEqual('web');
    });

    it('syncQueue is created', async () => {
      percy = new Percy({ token: 'PERCY_TOKEN', projectType: 'web' });

      // abort when the browser is launched
      let ctrl = new AbortController();
      spyOn(percy.browser, 'launch');

      await generatePromise(percy.yield.start(), ctrl.signal);
      expect(percy.syncQueue).toBeDefined();
      expect(percy.syncQueue.type).toEqual('snapshot');
    });

    it('has snapshotType comparison in syncQueue', async () => {
      percy = new Percy({ token: 'auto_token' });

      // abort when the browser is launched
      let ctrl = new AbortController();
      spyOn(percy.browser, 'launch');

      await generatePromise(percy.yield.start(), ctrl.signal);
      expect(percy.syncQueue.type).toEqual('comparison');
    });

    it('has snapshotType comparison in syncQueue with app percy', async () => {
      percy = new Percy({ token: 'token', projectType: 'app' });

      // abort when the browser is launched
      let ctrl = new AbortController();
      spyOn(percy.browser, 'launch');

      await generatePromise(percy.yield.start(), ctrl.signal);
      expect(percy.syncQueue.type).toEqual('comparison');
    });

    it('does not create an empty build when uploads are deferred', async () => {
      percy = new Percy({ token: 'PERCY_TOKEN', deferUploads: true });
      await expectAsync(percy.start()).toBeResolved();
      expect(api.requests['/builds']).toBeUndefined();

      // flush queues without uploads
      await percy.flush();

      expect(api.requests['/builds']).toBeUndefined();

      // flush a snapshot to create a build
      percy.snapshot('http://localhost:8000');
      await percy.flush();

      expect(api.requests['/builds']).toBeDefined();
    });

    it('does not create a build when uploads are skipped', async () => {
      percy = new Percy({ token: 'PERCY_TOKEN', skipUploads: true });
      await expectAsync(percy.start()).toBeResolved();
      expect(api.requests['/builds']).toBeUndefined();

      // process deferred uploads
      await percy.flush();

      expect(api.requests['/builds']).toBeUndefined();

      // stopping should also skip uploads
      await percy.stop();

      expect(api.requests['/builds']).toBeUndefined();

      expect(logger.stderr).toEqual(jasmine.arrayContaining([
        '[percy] Build not created'
      ]));
    });

    it('does not launch the browser and skips uploads when dry-running', async () => {
      percy = new Percy({ token: 'PERCY_TOKEN', dryRun: true });
      await expectAsync(percy.start()).toBeResolved();
      expect(percy.browser.isConnected()).toBe(false);
      expect(api.requests['/builds']).toBeUndefined();

      await percy.stop();

      expect(api.requests['/builds']).toBeUndefined();

      expect(logger.stderr).toEqual(jasmine.arrayContaining([
        '[percy] Build not created'
      ]));
    });

    it('stops accepting snapshots when a queued build fails to be created', async () => {
      api.reply('/builds', () => [401, {
        errors: [{ detail: 'build error' }]
      }]);

      percy = new Percy({ token: 'PERCY_TOKEN', deferUploads: true });
      await expectAsync(percy.start()).toBeResolved();

      await expectAsync(percy.snapshot({
        name: 'Snapshot 1',
        url: 'http://localhost:8000'
      })).toBeResolved();

      expect(api.requests['/builds']).toBeUndefined();
      expect(api.requests['/builds/123/snapshots']).toBeUndefined();

      // process deferred uploads
      await percy.flush();

      expect(api.requests['/builds']).toBeDefined();
      expect(api.requests['/builds/123/snapshots']).toBeUndefined();

      // throws synchronously
      expect(() => percy.snapshot({
        name: 'Snapshot 2',
        url: 'http://localhost:8000'
      })).toThrowError('Failed to create build');

      expect(logger.stdout).toEqual(jasmine.arrayContaining([
        '[percy] Percy has started!'
      ]));
      expect(logger.stderr).toEqual(jasmine.arrayContaining([
        '[percy] Failed to create build',
        '[percy] Error: build error'
      ]));
    });

    it('stops accepting snapshots when an in-progress build fails', async () => {
      api.reply('/builds/123/snapshots', () => [422, {
        errors: [{
          detail: 'Build has failed',
          source: { pointer: '/data/attributes/build' }
        }]
      }]);

      // create a new instance with default concurrency
      percy = new Percy({ token: 'PERCY_TOKEN', snapshot: { widths: [1000] } });
      await percy.start();

      await Promise.all([
        // upload will eventually fail
        percy.snapshot({
          url: 'http://localhost:8000/snapshot-1'
        }),
        // should not upload
        percy.snapshot({
          url: 'http://localhost:8000/snapshot-2',
          // delay this snapshot so the first upload can fail
          waitForTimeout: 100
        })
      ]);

      await percy.idle();

      expect(logger.stderr).toEqual(jasmine.arrayContaining([
        '[percy] Encountered an error uploading snapshot: /snapshot-1',
        '[percy] Error: Build has failed'
      ]));

      expect(api.requests['/builds/123/snapshots'].length).toEqual(1);

      // stops accepting snapshots
      expect(() => percy.snapshot({
        name: 'Snapshot 2',
        url: 'http://localhost:8000'
      })).toThrowError('Build has failed');
    });

    it('skips system check if proxy already present', async () => {
      process.env.HTTP_PROXY = 'some-proxy';
      const mockDetectProxy = spyOn(DetectProxy.prototype, 'getSystemProxy').and.returnValue([{ type: 'HTTP', host: 'proxy.example.com', port: 8080 }]);
      await expectAsync(percy.start()).toBeResolved();

      expect(mockDetectProxy).not.toHaveBeenCalled();
      expect(logger.stdout).toEqual([
        '[percy] Percy has started!'
      ]);
      delete process.env.HTTP_PROXY;
    });

    it('takes no action when no proxt is detected', async () => {
      spyOn(DetectProxy.prototype, 'getSystemProxy').and.returnValue([]);
      await expectAsync(percy.start()).toBeResolved();

      expect(logger.stdout).toEqual([
        '[percy] Percy has started!'
      ]);
    });

    it('checks for system level proxy and print warning', async () => {
      spyOn(DetectProxy.prototype, 'getSystemProxy').and.returnValue([{ type: 'HTTP', host: 'proxy.example.com', port: 8080 }]);
      await expectAsync(percy.start()).toBeResolved();

      expect(logger.stderr).toEqual([
        '[percy] We have detected a system level proxy in your system. use HTTP_PROXY or HTTPS_PROXY env vars or To auto apply proxy set useSystemProxy: true under percy in config file'
      ]);
      expect(logger.stdout).toEqual([
        '[percy] Percy has started!'
      ]);
    });

    it('checks for system level proxy and auto apply', async () => {
      spyOn(DetectProxy.prototype, 'getSystemProxy').and.returnValue([
        { type: 'HTTP', host: 'proxy.example.com', port: 8080 },
        { type: 'HTTPS', host: 'secureproxy.example.com', port: 8443 },
        { type: 'SOCK', host: 'sockproxy.example.com', port: 8081 }
      ]);

      percy = new Percy({ token: 'PERCY_TOKEN', percy: { useSystemProxy: true } });
      await percy.start();

      expect(process.env.HTTPS_PROXY).toEqual('https://secureproxy.example.com:8443');
      expect(process.env.HTTP_PROXY).toEqual('http://proxy.example.com:8080');
      delete process.env.HTTPS_PROXY;
      delete process.env.HTTP_PROXY;
    });

    it('should not cause error when failed to detect system level proxy', async () => {
      spyOn(DetectProxy.prototype, 'getSystemProxy').and.rejectWith('some error');
      await expectAsync(percy.start()).toBeResolved();
    });
  });

  describe('#stop()', () => {
    // stop the previously started instance and clear requests
    async function reset(options) {
      await percy.stop().then(() => logger.reset());
      Object.keys(api.requests).map(k => delete api.requests[k]);
      percy = await Percy.start({ token: 'PERCY_TOKEN', ...options });
    }

    beforeEach(async () => {
      await percy.start();
    });

    it('finalizes the build', async () => {
      await expectAsync(percy.stop()).toBeResolved();
      expect(api.requests['/builds/123/finalize']).toBeDefined();

      // This is the condition for no snapshot command was called
      expect(logger.stderr).toEqual([
        '[percy] Detected error for percy build',
        '[percy] Failure: Snapshot command was not called',
        '[percy] Failure Reason: Snapshot Command was not called. please check your CI for errors',
        '[percy] Suggestion: Try using percy snapshot command to take snapshots',
        '[percy] Refer to the below Doc Links for the same',
        '[percy] * https://www.browserstack.com/docs/percy/take-percy-snapshots/'
      ]);

      expect(logger.stdout).toContain(
        '[percy] Finalized build #1: https://percy.io/test/test/123'
      );
    });

    it('stops the server', async () => {
      let { request } = await import('./helpers/request.js');
      await expectAsync(request('http://localhost:5338', false)).toBeResolved();
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
      expect(api.requests['/builds']).toBeUndefined();
      expect(api.requests['/builds/123/finalize']).toBeUndefined();

      expect(logger.stdout).toContain(
        '[percy] Stopping percy...'
      );
      expect(logger.stderr).toEqual(jasmine.arrayContaining([
        '[percy] Build not created'
      ]));
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

      percy.snapshot('http://localhost:8000/one');
      percy.snapshot('http://localhost:8000/two');
      percy.snapshot('http://localhost:8000/three');

      await expectAsync(percy.stop()).toBeResolved();

      expect(logger.stdout).toEqual(jasmine.arrayContaining([
        '[percy] Snapshot found: /one',
        '[percy] Snapshot found: /two',
        '[percy] Snapshot found: /three',
        '[percy] Found 3 snapshots'
      ]));
      expect(logger.stderr).toEqual(jasmine.arrayContaining([
        '[percy] Build not created'
      ]));
    });

    it('cleans up the server and browser before finalizing', async () => {
      api.reply('/builds/123/finalize', () => [401, {
        errors: [{ detail: 'finalize error' }]
      }]);

      await expectAsync(percy.stop()).toBeRejectedWithError('finalize error');
      expect(percy.server.listening).toBe(false);
      expect(percy.browser.isConnected()).toBe(false);
    });

    it('does not clean up if canceled while waiting on pending tasks', async () => {
      let snapshots = [
        percy.snapshot('http://localhost:8000/one'),
        percy.snapshot('http://localhost:8000/two'),
        percy.snapshot('http://localhost:8000/three')
      ];

      let ctrl = new AbortController();
      // #yield.stop returns a generator that can be aborted
      let stopped = generatePromise(percy.yield.stop(), ctrl.signal);

      // wait until the first snapshot is done before canceling
      await snapshots[0];
      ctrl.abort();

      await expectAsync(stopped).toBeRejected();
      expect(percy.readyState).toEqual(1);
      expect(percy.server.listening).toBe(true);
      expect(percy.browser.isConnected()).toBe(true);
      expect(api.requests['/builds/123/finalize']).toBeUndefined();

      expect(logger.stdout).toEqual(jasmine.arrayContaining([
        '[percy] Percy has started!',
        '[percy] Processing 3 snapshots...',
        '[percy] Snapshot taken: /one'
      ]));

      // stop without canceling to verify it still works
      await percy.stop();

      expect(percy.readyState).toEqual(3);
      expect(percy.server.listening).toBe(false);
      expect(percy.browser.isConnected()).toBe(false);
      expect(api.requests['/builds/123/finalize']).toBeDefined();

      expect(logger.stdout).toEqual(jasmine.arrayContaining([
        '[percy] Snapshot taken: /two',
        '[percy] Snapshot taken: /three'
      ]));
    });

    it('does not error if the browser was never launched', async () => {
      await reset({ dryRun: true });

      percy.snapshot('http://localhost:8000');

      expect(percy.browser.isConnected()).toBe(false);
      await expectAsync(percy.stop()).toBeResolved();
      expect(percy.browser.isConnected()).toBe(false);

      expect(logger.stdout).toEqual(jasmine.arrayContaining([
        '[percy] Found 1 snapshot'
      ]));
      expect(logger.stderr).toEqual(jasmine.arrayContaining([
        '[percy] Build not created'
      ]));
    });

    it('logs when the build has failed upstream', async () => {
      api.reply('/builds/123/snapshots', () => [422, {
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
      expect(logger.stderr).toEqual(jasmine.arrayContaining([
        '[percy] Encountered an error uploading snapshot: test snapshot',
        '[percy] Error: Build has failed',
        '[percy] Build #1 failed: https://percy.io/test/test/123'
      ]));
    });
  });

  describe('#idle()', () => {
    beforeEach(async () => {
      await percy.start();
    });

    it('resolves after snapshots idle', async () => {
      percy.snapshot({
        name: 'test snapshot',
        url: 'http://localhost:8000',
        domSnapshot: '<html></html>',
        widths: [1000]
      });

      expect(api.requests['/builds/123/snapshots']).toBeUndefined();
      await percy.idle();
      expect(api.requests['/builds/123/snapshots']).toHaveSize(1);
    });
  });

  describe('#flush()', () => {
    let snapshots;

    beforeEach(async () => {
      snapshots = [];

      percy = await Percy.start({
        token: 'PERCY_TOKEN',
        snapshot: { widths: [1000] },
        deferUploads: true
      });

      for (let i = 0; i < 3; i++) {
        let resolve, deferred = new Promise(r => (resolve = r));
        deferred = deferred.then(() => [200, 'text/html', `#${i}`]);
        server.reply(`/deferred/${i}`, () => deferred);

        let promise = percy.snapshot(`http://localhost:8000/deferred/${i}`);
        snapshots.push({ resolve, deferred, promise });
      }
    });

    afterEach(() => {
      // no hanging promises
      for (let { resolve } of snapshots) resolve();
    });

    it('resolves after flushing all snapshots', async () => {
      let all = Promise.all(snapshots.map(s => s.promise));
      let flush = percy.flush();

      await expectAsync(flush).toBePending();
      await expectAsync(all).toBePending();

      snapshots[0].resolve();
      snapshots[1].resolve();
      await expectAsync(flush).toBePending();
      await expectAsync(all).toBePending();

      snapshots[2].resolve();
      await expectAsync(flush).toBeResolved();
      await expectAsync(all).toBeResolved();
    });

    it('resolves after flushing one or more named snapshots', async () => {
      let flush1 = percy.flush(
        { name: '/deferred/1' }
      );

      await expectAsync(flush1).toBePending();
      await expectAsync(snapshots[0].promise).toBePending();
      await expectAsync(snapshots[1].promise).toBePending();
      await expectAsync(snapshots[2].promise).toBePending();

      snapshots[1].resolve();
      await expectAsync(flush1).toBeResolved();
      await expectAsync(snapshots[0].promise).toBePending();
      await expectAsync(snapshots[1].promise).toBeResolved();
      await expectAsync(snapshots[2].promise).toBePending();

      let flush2 = percy.flush([
        { name: '/deferred/0' },
        { name: '/deferred/2' }
      ]);

      snapshots[2].resolve();
      await expectAsync(flush2).toBePending();
      await expectAsync(snapshots[0].promise).toBePending();
      await expectAsync(snapshots[1].promise).toBeResolved();
      await expectAsync(snapshots[2].promise).toBeResolved();

      snapshots[0].resolve();
      await expectAsync(flush2).toBeResolved();
      await expectAsync(snapshots[0].promise).toBeResolved();
      await expectAsync(snapshots[1].promise).toBeResolved();
      await expectAsync(snapshots[2].promise).toBeResolved();
    });
  });

  describe('#upload()', () => {
    it('errors when not running', async () => {
      await percy.stop();
      expect(() => percy.upload({})).toThrowError('Not running');
    });

    it('pushes snapshots to the internal queue', async () => {
      await percy.start();
      expect(api.requests['/builds/123/snapshots']).toBeUndefined();
      await percy.upload({ name: 'Snapshot 1' });
      expect(api.requests['/builds/123/snapshots']).toHaveSize(1);
      await percy.upload([{ name: 'Snapshot 2' }, { name: 'Snapshot 3' }]);
      expect(api.requests['/builds/123/snapshots']).toHaveSize(3);
    });

    it('can provide a resources function to evaluate within the queue', async () => {
      let resources = jasmine.createSpy('resources').and.returnValue([
        { sha: 'eval1', url: '/eval-1', content: 'foo' },
        { sha: 'eval2', url: '/eval-2', content: 'bar' }
      ]);

      await percy.start();
      await percy.upload({ name: 'Snapshot', resources });
      expect(resources).toHaveBeenCalled();

      expect(api.requests['/builds/123/snapshots']).toHaveSize(1);
      expect(api.requests['/builds/123/resources']).toHaveSize(2);
      expect(api.requests['/snapshots/4567/finalize']).toHaveSize(1);

      let partial = jasmine.objectContaining;
      expect(api.requests['/builds/123/snapshots'][0])
        .toHaveProperty('body.data.relationships.resources.data', [
          partial({ attributes: partial({ 'resource-url': '/eval-1' }) }),
          partial({ attributes: partial({ 'resource-url': '/eval-2' }) })
        ]);
    });

    it('can push snapshot comparisons to the internal queue', async () => {
      await percy.start();

      await percy.upload({
        name: 'Snapshot',
        tag: { name: 'device' },
        tiles: [{ content: 'foo' }, { content: 'bar' }]
      });

      expect(api.requests['/builds/123/snapshots']).toHaveSize(1);
      expect(api.requests['/snapshots/4567/comparisons']).toHaveSize(1);
      expect(api.requests['/comparisons/891011/tiles']).toHaveSize(2);
      expect(api.requests['/comparisons/891011/finalize']).toHaveSize(1);
      expect(api.requests['/snapshots/4567/finalize']).toBeUndefined();

      expect(logger.stderr).toEqual([]);
      expect(logger.stdout).toEqual([
        '[percy] Percy has started!',
        '[percy] Snapshot taken: Snapshot'
      ]);
    });

    it('should push snapshot comparisons to the wait for snapshot queue', async () => {
      const mockResolve = jasmine.createSpy('resolve');
      const mockReject = jasmine.createSpy('reject');
      await percy.start();

      await percy.upload({
        name: 'Snapshot',
        tag: { name: 'device' },
        tiles: [{ content: 'foo' }, { content: 'bar' }],
        sync: true
      }, { resolve: mockResolve, reject: mockReject });

      await percy.idle();
      expect(api.requests['/builds/123/snapshots']).toHaveSize(1);
      expect(api.requests['/snapshots/4567/comparisons']).toHaveSize(1);
      expect(api.requests['/comparisons/891011/tiles']).toHaveSize(2);
      expect(api.requests['/comparisons/891011/finalize']).toHaveSize(1);
      expect(api.requests['/snapshots/4567/finalize']).toBeUndefined();

      expect(logger.stderr).toEqual([]);
      expect(percy.syncQueue.jobs).toHaveSize(1);
      expect(logger.stdout).toEqual([
        '[percy] Percy has started!',
        '[percy] Snapshot taken: Snapshot',
        '[percy] Waiting for snapshot \'Snapshot\' to be completed'
      ]);
    });

    it('should raise warning in case of upload command with sync', async () => {
      percy = new Percy({
        token: 'PERCY_TOKEN',
        snapshot: { widths: [1000] },
        discovery: { concurrency: 1 },
        clientInfo: 'client-info',
        environmentInfo: 'env-info',
        deferUploads: true,
        skipDiscovery: true
      });
      await percy.start();

      percy.upload({
        name: 'Snapshot',
        tag: { name: 'device' },
        tiles: [{ content: 'foo' }, { content: 'bar' }],
        sync: true
      });

      await percy.flush();
      expect(api.requests['/builds/123/snapshots']).toHaveSize(1);
      expect(api.requests['/snapshots/4567/comparisons']).toHaveSize(1);
      expect(api.requests['/comparisons/891011/tiles']).toHaveSize(2);
      expect(api.requests['/comparisons/891011/finalize']).toHaveSize(1);
      expect(api.requests['/snapshots/4567/finalize']).toBeUndefined();

      expect(logger.stderr).toEqual(jasmine.arrayContaining([
        '[percy] The Synchronous CLI functionality is not compatible with upload command.'
      ]));
      expect(percy.syncQueue.jobs).toHaveSize(0);
    });

    it('errors when missing any required properties', async () => {
      await percy.start();

      expect(() => percy.upload({
        tag: { name: 'device' },
        tiles: [{ content: 'missing' }]
      })).toThrowError('Missing required snapshot name');

      expect(() => percy.upload({
        name: 'Missing tag name',
        tiles: [{ content: 'missing' }]
      })).toThrowError('Missing required tag name for comparison');
    });

    it('warns about invalid snapshot comparison options', async () => {
      await percy.start();

      await percy.upload({
        name: 'Snapshot',
        external_debug_url: 'localhost',
        some_other_rand_prop: 'random value',
        tag: { name: 'device', foobar: 'baz' },
        tiles: [{ content: 'foo' }, { content: [123] }]
      });

      expect(api.requests['/snapshots/4567/comparisons']).toHaveSize(1);
      expect(api.requests['/comparisons/891011/tiles']).toHaveSize(1);

      expect(logger.stderr).toEqual(jasmine.arrayContaining([
        '[percy] Invalid upload options:',
        '[percy] - someOtherRandProp: unknown property',
        '[percy] - tag.foobar: unknown property',
        '[percy] - tiles[1].content: must be a string, received an array'
      ]));
      expect(logger.stdout).toEqual([
        '[percy] Percy has started!',
        '[percy] Snapshot taken: Snapshot'
      ]);
    });

    it('can cancel pending pushed snapshots', async () => {
      percy = await Percy.start({
        token: 'PERCY_TOKEN',
        deferUploads: true
      });

      let ctrl = new AbortController();
      let promised = generatePromise((
        percy.yield.upload({ name: 'Snapshot' })
      ), ctrl.signal);

      await expectAsync(promised).toBePending();

      ctrl.abort();
      await expectAsync(promised)
        .toBeRejectedWith(ctrl.signal.reason);

      await percy.stop();
      expect(api.requests['/builds']).toBeUndefined();
      expect(api.requests['/builds/123/snapshots']).toBeUndefined();
    });
  });

  describe('#shouldSkipAssetDiscovery', () => {
    it('should return true if testing is true', () => {
      percy = new Percy({
        token: 'PERCY_TOKEN',
        snapshot: { widths: [1000] },
        discovery: { concurrency: 1 },
        clientInfo: 'client-info',
        environmentInfo: 'env-info',
        testing: true
      });
      expect(percy.shouldSkipAssetDiscovery(percy.client.tokenType())).toBe(true);
    });

    it('should return false if token is not set', () => {
      percy = new Percy({
        snapshot: { widths: [1000] },
        discovery: { concurrency: 1 },
        clientInfo: 'client-info',
        environmentInfo: 'env-info'
      });
      expect(percy.shouldSkipAssetDiscovery(percy.client.tokenType())).toBe(false);
    });

    it('should return false if web token is set', () => {
      percy = new Percy({
        token: 'PERCY_TOKEN',
        snapshot: { widths: [1000] },
        discovery: { concurrency: 1 },
        clientInfo: 'client-info',
        environmentInfo: 'env-info'
      });
      expect(percy.shouldSkipAssetDiscovery(percy.client.tokenType())).toBe(false);
    });

    it('should return true if auto token is set', () => {
      percy = new Percy({
        token: 'auto_PERCY_TOKEN',
        snapshot: { widths: [1000] },
        discovery: { concurrency: 1 },
        clientInfo: 'client-info',
        environmentInfo: 'env-info'
      });
      expect(percy.shouldSkipAssetDiscovery(percy.client.tokenType())).toBe(true);
    });
  });

  describe('sendBuildLogs', () => {
    it('should return if PERCY_TOKEN is not set', async () => {
      delete process.env.PERCY_TOKEN;
      percy = new Percy({
        token: 'PERCY_TOKEN',
        snapshot: { widths: [1000] },
        discovery: { concurrency: 1 },
        clientInfo: 'client-info',
        environmentInfo: 'env-info'
      });
      await expectAsync(percy.sendBuildLogs()).toBeResolved();
      expect(api.requests['/logs']).not.toBeDefined();
    });

    it('should not add CI logs if PERCY_CLIENT_ERROR_LOGS is false', async () => {
      process.env.PERCY_TOKEN = 'PERCY_TOKEN';
      process.env.PERCY_CLIENT_ERROR_LOGS = 'false';
      percy = new Percy({
        token: 'PERCY_TOKEN',
        snapshot: { widths: [1000] },
        discovery: { concurrency: 1 },
        clientInfo: 'client-info',
        environmentInfo: 'env-info'
      });

      percy.log.info('cli_test');
      percy.log.info('ci_test', {}, true);
      const logsObject = {
        clilogs: Array.from(logger.instance.messages)
      };

      const content = base64encode(Pako.gzip(JSON.stringify(logsObject)));
      await expectAsync(percy.sendBuildLogs()).toBeResolved();
      expect(api.requests['/logs']).toBeDefined();
      expect(api.requests['/logs'][0].method).toBe('POST');
      expect(api.requests['/logs'][0].body).toEqual({
        data: {
          content: content,
          service_name: 'cli',
          base64encoded: true
        }
      });
      expect(logger.stdout).toEqual(jasmine.arrayContaining([
        "[percy] Build's CLI logs sent successfully. Please share this log ID with Percy team in case of any issues - random_sha"
      ]));
    });

    it('should add CI logs if PERCY_CLIENT_ERROR_LOGS is not present', async () => {
      process.env.PERCY_TOKEN = 'PERCY_TOKEN';
      delete process.env.PERCY_CLIENT_ERROR_LOGS;
      percy = new Percy({
        token: 'PERCY_TOKEN',
        snapshot: { widths: [1000] },
        discovery: { concurrency: 1 },
        clientInfo: 'client-info',
        environmentInfo: 'env-info'
      });
      percy.build = { id: 1 };
      percy.log.info('cli_test');
      percy.log.info('ci_test', {}, true);
      const logsObject = {
        clilogs: logger.instance.query(log => log.debug !== 'ci'),
        cilogs: logger.instance.query(log => log.debug === 'ci')
      };

      const content = base64encode(Pako.gzip(JSON.stringify(logsObject)));
      await expectAsync(percy.sendBuildLogs()).toBeResolved();
      expect(api.requests['/logs']).toBeDefined();
      expect(api.requests['/logs'][0].method).toBe('POST');
      expect(api.requests['/logs'][0].body).toEqual({
        data: {
          content: content,
          service_name: 'cli',
          build_id: 1,
          reference_id: 'build_1',
          base64encoded: true
        }
      });
      expect(logger.stdout).toEqual(jasmine.arrayContaining([
        "[percy] Build's CLI and CI logs sent successfully. Please share this log ID with Percy team in case of any issues - random_sha"
      ]));
    });

    it('should catch the error in sending build logs', async () => {
      process.env.PERCY_TOKEN = 'PERCY_TOKEN';
      delete process.env.PERCY_CLIENT_ERROR_LOGS;
      percy = new Percy({
        token: 'PERCY_TOKEN',
        snapshot: { widths: [1000] },
        discovery: { concurrency: 1 },
        clientInfo: 'client-info',
        environmentInfo: 'env-info'
      });
      spyOn(percy.client, 'sendBuildLogs').and.rejectWith('error');
      await expectAsync(percy.sendBuildLogs()).toBeResolved();
      expect(logger.stderr).toEqual(jasmine.arrayContaining([
        '[percy] Could not send the builds logs'
      ]));
    });
  });

  describe('#suggestionsForFix', () => {
    beforeEach(() => {
      percy = new Percy({
        token: 'PERCY_TOKEN',
        snapshot: { widths: [1000] },
        discovery: { concurrency: 1 },
        clientInfo: 'client-info',
        environmentInfo: 'env-info'
      });
      percy.build = { id: 1 };
    });

    describe('when suggestionResponse.length > 0', () => {
      describe('for build level error', () => {
        it('should log failureReason, suggestion, and doc links', async () => {
          spyOn(percy.client, 'getErrorAnalysis').and.returnValue([{
            suggestion: 'some suggestion',
            reason_message: 'some failure reason',
            failure_reason: 'some failure title',
            reference_doc_link: ['Doc Link 1', 'Doc Link 2']
          }]);

          await expectAsync(percy.suggestionsForFix('some_error')).toBeResolved();
          expect(logger.stderr).toEqual(jasmine.arrayContaining([
            '[percy] Detected error for percy build',
            '[percy] Failure: some failure title',
            '[percy] Failure Reason: some failure reason',
            '[percy] Suggestion: some suggestion',
            '[percy] Refer to the below Doc Links for the same',
            '[percy] * Doc Link 1',
            '[percy] * Doc Link 2'
          ]));
        });

        describe('when no reference doc links is provided', () => {
          it('should log failureReason and suggestion', async () => {
            spyOn(percy.client, 'getErrorAnalysis').and.returnValue([{
              suggestion: 'some suggestion',
              failure_reason: 'some failure reason',
              reference_doc_link: null
            }]);

            await expectAsync(percy.suggestionsForFix('some_error')).toBeResolved();
            expect(logger.stderr).toEqual(jasmine.arrayContaining([
              '[percy] Detected error for percy build',
              '[percy] Failure: some failure reason',
              '[percy] Failure Reason: undefined',
              '[percy] Suggestion: some suggestion'
            ]));
          });
        });
      });

      describe('for snapshotLevel error', () => {
        it('should log failureReason, suggestion, and doc links with snapshotName', async () => {
          spyOn(percy.client, 'getErrorAnalysis').and.returnValue([{
            suggestion: 'some suggestion',
            failure_reason: 'some failure reason',
            reference_doc_link: ['Doc Link 1', 'Doc Link 2']
          }]);

          await expectAsync(percy.suggestionsForFix('some_error', {
            snapshotLevel: true,
            snapshotName: 'Snapshot 1'
          })).toBeResolved();

          expect(logger.stderr).toEqual(jasmine.arrayContaining([
            '[percy] Detected erorr for Snapshot: Snapshot 1',
            '[percy] Failure: some failure reason',
            '[percy] Failure Reason: undefined',
            '[percy] Suggestion: some suggestion',
            '[percy] Refer to the below Doc Links for the same',
            '[percy] * Doc Link 1',
            '[percy] * Doc Link 2'
          ]));
        });
      });
    });

    describe('when response throw error', () => {
      describe('when Request failed with error code of EHOSTUNREACH', () => {
        it('should catch and logs expected error', async () => {
          spyOn(percy.client, 'getErrorAnalysis').and.rejectWith({ code: 'EHOSTUNREACH', message: 'some error' });

          await expectAsync(percy.suggestionsForFix('some_error')).toBeResolved();

          expect(logger.stderr).toEqual(jasmine.arrayContaining([
            '[percy] percy.io might not be reachable, check network connection, proxy and ensure that percy.io is whitelisted.',
            '[percy] If inside a proxied envirnment, please configure the following environment variables: HTTP_PROXY, [ and optionally HTTPS_PROXY if you need it ]. Refer to our documentation for more details',
            '[percy] Unable to analyze error logs'
          ]));
        });
      });

      describe('when Request failed with error code ECONNREFUSED and HTTPS_PROXY env is enabled', () => {
        beforeEach(() => {
          process.env.HTTPS_PROXY = 'https://abc.com';
        });

        afterEach(() => {
          delete process.env.HTTPS_PROXY;
        });

        it('should catch and logs expected error', async () => {
          spyOn(percy.client, 'getErrorAnalysis').and.rejectWith({ code: 'ECONNREFUSED', message: 'some error' });

          await expectAsync(percy.suggestionsForFix('some_error')).toBeResolved();

          expect(logger.stderr).toEqual(jasmine.arrayContaining([
            '[percy] percy.io might not be reachable, check network connection, proxy and ensure that percy.io is whitelisted.',
            '[percy] Unable to analyze error logs'
          ]));
        });
      });

      describe('when request failed due to some unexpected issue', () => {
        it('should catch and logs expected error', async () => {
          spyOn(percy.client, 'getErrorAnalysis').and.rejectWith('some_error');

          await expectAsync(percy.suggestionsForFix('some_error', {
            snapshotLevel: true,
            snapshotName: 'Snapshot 1'
          })).toBeResolved();

          expect(logger.stderr).toEqual(jasmine.arrayContaining([
            '[percy] Unable to analyze error logs'
          ]));
        });
      });
    });
  });

  describe('#checkForNoSnapshotCommandError', () => {
    it('should log No snapshot command was called', async () => {
      percy = new Percy({
        token: 'PERCY_TOKEN',
        snapshot: { widths: [1000] },
        discovery: { concurrency: 1 }
      });

      await percy.start();
      await percy.stop(true);

      expect(logger.stderr).toEqual(jasmine.arrayContaining([
        '[percy] Detected error for percy build',
        '[percy] Failure: Snapshot command was not called',
        '[percy] Failure Reason: Snapshot Command was not called. please check your CI for errors',
        '[percy] Suggestion: Try using percy snapshot command to take snapshots',
        '[percy] Refer to the below Doc Links for the same',
        '[percy] * https://www.browserstack.com/docs/percy/take-percy-snapshots/'
      ]));
    });

    it('should not log No snapshot command was called', async () => {
      await percy.start();
      await percy.snapshot({
        name: 'test snapshot',
        url: 'http://localhost:8000',
        domSnapshot: '<html></html>'
      });
      await percy.stop(true);
      expect(logger.stderr).toEqual(jasmine.arrayContaining([]));
    });
  });
});
