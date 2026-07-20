import os from 'os';
import path from 'path';
import PercyConfig from '@percy/config';
import { logger, setupTest, fs } from './helpers/index.js';
import Percy from '@percy/core';
import WebdriverUtils from '@percy/webdriver-utils';
import { getPercyDomPath, _applyHttpReadOnlyStripping } from '../src/api.js';

describe('API Server', () => {
  let percy;
  const getSnapshotDetailsResponse = { name: 'test', 'diff-ratio': 0 };

  async function request(path, ...args) {
    let { request } = await import('./helpers/request.js');
    return request(new URL(path, percy.address()), ...args);
  }

  beforeEach(async () => {
    process.env.PERCY_FORCE_PKG_VALUE = JSON.stringify({ name: '@percy/client', version: '1.0.0' });
    jasmine.DEFAULT_TIMEOUT_INTERVAL = 150000;
    // The self-hosted maestro tests exercise a recursive `**` + `dot:true`
    // fast-glob against a `.maestro/` directory. fast-glob's recursive-dot
    // traversal is unreliable against memfs across volume resets in the full
    // suite (works in isolation; returns [] mid-suite), so route the
    // self-hosted root to the REAL filesystem — this also tests the true
    // production glob path. Only paths under this unique root are affected.
    await setupTest({ filesystem: { $bypass: [p => typeof p === 'string' && p.includes('percy-self-hosted-real')] } });

    percy = new Percy({
      token: 'PERCY_TOKEN',
      port: 1337
    });
  });

  afterEach(async () => {
    percy.stop.and?.callThrough();
    await percy.stop();
    delete process.env.PERCY_FORCE_PKG_VALUE;
  });

  it('has a default port', () => {
    expect(new Percy()).toHaveProperty('server.port', 5338);
  });

  it('can specify a custom port', () => {
    expect(percy).toHaveProperty('server.port', 1337);
  });

  it('should log on createRequire failure', () => {
    getPercyDomPath(undefined);
    expect(logger.stderr.length).toBeGreaterThan(0);
  });

  it('starts a server at the specified port', async () => {
    await expectAsync(percy.start()).toBeResolved();
    await expectAsync(request('/', false)).toBeResolved();
  });

  it('has a /healthcheck endpoint', async () => {
    let { getPackageJSON } = await import('@percy/client/utils');
    let pkg = getPackageJSON(import.meta.url);
    await percy.start();

    let [data, res] = await request('/percy/healthcheck', true);
    expect(res.headers).toHaveProperty('x-percy-core-version', pkg.version);
    expect(data).toEqual({
      success: true,
      loglevel: 'info',
      config: PercyConfig.getDefaults(),
      widths: { mobile: [], config: PercyConfig.getDefaults().snapshot.widths },
      deviceDetails: [],
      // Two-slot drift envelope (Unit 4). Both slots null in steady state.
      maestroHierarchyDrift: { android: null, ios: null },
      build: {
        id: '123',
        number: 1,
        url: 'https://percy.io/test/test/123'
      },
      type: percy.client.tokenType()
    });
  });

  it('has a /config endpoint that returns loaded config options', async () => {
    await percy.start();

    await expectAsync(request('/percy/config')).toBeResolvedTo({
      success: true,
      config: PercyConfig.getDefaults()
    });
  });

  it('should return widths present in config and fetch widths for devices', async () => {
    await percy.start();
    percy.deviceDetails = [{ width: 390, devicePixelRatio: 2 }];
    percy.config = PercyConfig.getDefaults({ snapshot: { widths: [1000] } });

    await expectAsync(request('/percy/healthcheck')).toBeResolvedTo(jasmine.objectContaining({
      widths: {
        mobile: [390],
        config: [1000]
      },
      deviceDetails: [{ width: 390, devicePixelRatio: 2 }]
    }));
  });

  it('can set config options via the /config endpoint', async () => {
    let expected = PercyConfig.getDefaults({ snapshot: { widths: [1000] } });
    await percy.start();

    expect(percy.config).not.toEqual(expected);

    await expectAsync(request('/percy/config', {
      method: 'POST',
      body: { snapshot: { widths: [1000] } }
    })).toBeResolvedTo({
      config: expected,
      success: true
    });

    expect(percy.config).toEqual(expected);
  });

  it('does not warn when /config POST contains launchOptions without blocked keys', async () => {
    await percy.start();

    await request('/percy/config', {
      method: 'POST',
      body: { discovery: { launchOptions: { headless: false, closeBrowser: false } } }
    });

    expect(percy.config.discovery.launchOptions.headless).toBe(false);
    expect(percy.config.discovery.launchOptions.closeBrowser).toBe(false);
    expect(logger.stderr).not.toEqual(jasmine.arrayContaining([
      jasmine.stringMatching(/Ignoring `discovery\.launchOptions/)
    ]));
  });

  it('strips security-sensitive launchOptions fields from /config POST', async () => {
    await percy.start();

    let before = percy.config.discovery.launchOptions;
    expect(before.executable).toBeUndefined();
    expect(before.args).toBeUndefined();

    await request('/percy/config', {
      method: 'POST',
      body: {
        discovery: {
          launchOptions: {
            executable: '/tmp/evil-binary',
            args: ['--renderer-cmd-prefix=/tmp/payload'],
            headless: false,
            closeBrowser: false
          }
        }
      }
    });

    // dangerous fields ignored
    expect(percy.config.discovery.launchOptions.executable).toBeUndefined();
    expect(percy.config.discovery.launchOptions.args).toBeUndefined();
    // benign fields still settable
    expect(percy.config.discovery.launchOptions.headless).toBe(false);
    expect(percy.config.discovery.launchOptions.closeBrowser).toBe(false);

    expect(logger.stderr).toEqual(jasmine.arrayContaining([
      jasmine.stringMatching(/Ignoring `discovery\.launchOptions\.executable`/),
      jasmine.stringMatching(/Ignoring `discovery\.launchOptions\.args`/)
    ]));
  });

  it('rejects /config POST carrying a cross-origin Origin header (PER-8601)', async () => {
    await percy.start();
    let before = percy.config;

    await expectAsync(request('/percy/config', {
      method: 'POST',
      body: { snapshot: { widths: [1234] } },
      headers: { Origin: 'https://evil.example' }
    })).toBeRejected();

    // live config was not mutated by the cross-origin request
    expect(percy.config).toEqual(before);
  });

  it('allows /config POST from a loopback origin', async () => {
    await percy.start();

    await expectAsync(request('/percy/config', {
      method: 'POST',
      body: { snapshot: { widths: [1000] } },
      headers: { Origin: 'http://localhost:6006' }
    })).toBeResolved();

    expect(percy.config.snapshot.widths).toEqual([1000]);
  });

  it('rejects /stop carrying a cross-origin Origin header (PER-8600)', async () => {
    await percy.start();
    let stopSpy = spyOn(percy, 'stop').and.resolveTo();

    await expectAsync(request('/percy/stop', {
      method: 'POST',
      headers: { Origin: 'https://evil.example' }
    })).toBeRejected();

    expect(stopSpy).not.toHaveBeenCalled();
  });

  it('does not stop Percy on a GET to /stop (no-Origin CSRF vector, PER-8600)', async () => {
    await percy.start();
    let stopSpy = spyOn(percy, 'stop').and.resolveTo();

    // A browser can issue a cross-origin GET (e.g. via <img>) with no Origin
    // header; the endpoint is POST-only so this must not reach the handler.
    await expectAsync(request('/percy/stop', 'GET')).toBeRejected();

    expect(stopSpy).not.toHaveBeenCalled();
  });

  it('blocks cross-origin POSTs to every state-changing endpoint at the middleware choke point (PER-8600/8601)', async () => {
    await percy.start();

    // CORS-safelisted content types reach these handlers with no preflight, but
    // a cross-origin request always carries an Origin, so the general-middleware
    // choke point must reject all of them before any side effect runs.
    let endpoints = [
      '/percy/snapshot', '/percy/comparison', '/percy/comparison/upload',
      '/percy/maestro-screenshot', '/percy/flush', '/percy/automateScreenshot',
      '/percy/events', '/percy/log'
    ];

    for (let path of endpoints) {
      await expectAsync(request(path, {
        method: 'POST',
        body: { name: 'x' },
        headers: { Origin: 'https://evil.example' }
      })).toBeRejectedWithError(/Cross-origin requests are not allowed/);
    }
  });

  it('has an /idle endpoint that calls #idle()', async () => {
    spyOn(percy, 'idle').and.resolveTo();
    await percy.start();

    await expectAsync(request('/percy/idle')).toBeResolvedTo({ success: true });
    expect(percy.idle).toHaveBeenCalled();
  });

  it('serves the @percy/dom bundle', async () => {
    await percy.start();

    await expectAsync(request('/percy/dom.js')).toBeResolvedTo(
      fs.readFileSync(path.resolve('../dom/dist/bundle.js'), 'utf-8')
    );
  });

  it('serves the legacy percy-agent.js dom bundle', async () => {
    await percy.start();

    await expectAsync(request('/percy-agent.js')).toBeResolvedTo(
      fs.readFileSync(path.resolve('../dom/dist/bundle.js'), 'utf-8').concat(
        '(window.PercyAgent = class { snapshot(n, o) { return PercyDOM.serialize(o); } });'
      )
    );

    expect(logger.stderr).toEqual(jasmine.arrayContaining(['[percy] Warning: ' + [
      'It looks like you’re using @percy/cli with an older SDK.',
      'Please upgrade to the latest version to fix this warning.',
      'See these docs for more info: https://www.browserstack.com/docs/percy/migration/migrate-to-cli'
    ].join(' ')]));
  });

  it('has a /flush endpoint that calls #flush()', async () => {
    spyOn(percy, 'flush').and.resolveTo();
    await percy.start();

    await expectAsync(request('/percy/flush', {
      body: { name: 'Snapshot name' },
      method: 'post'
    })).toBeResolvedTo({ success: true });

    expect(percy.flush).toHaveBeenCalledWith({
      name: 'Snapshot name'
    });
  });

  it('has a /stop endpoint that calls #stop()', async () => {
    spyOn(percy, 'stop').and.resolveTo();
    await percy.start();

    await expectAsync(request('/percy/stop', 'POST')).toBeResolvedTo({ success: true });
    expect(percy.stop).toHaveBeenCalled();
  });

  it('has a /snapshot endpoint that calls #snapshot() with provided options', async () => {
    spyOn(percy.client, 'getSnapshotDetails');
    spyOn(percy, 'snapshot').and.resolveTo();
    await percy.start();

    await expectAsync(request('/percy/snapshot', {
      method: 'POST',
      body: { 'test-me': true, me_too: true }
    })).toBeResolvedTo({
      success: true
    });

    expect(percy.client.getSnapshotDetails).not.toHaveBeenCalled();
    expect(percy.snapshot).toHaveBeenCalledOnceWith(
      { 'test-me': true, me_too: true }, {}
    );
  });

  it('has a /snapshot endpoint that calls #snapshot() with provided options in sync mode', async () => {
    spyOn(percy.client, 'getSnapshotDetails').and.returnValue(getSnapshotDetailsResponse);
    spyOn(percy, 'snapshot').and.callFake((_, promise) => promise.test = new Promise((resolve, reject) => setTimeout(() => resolve(), 100)));
    await percy.start();

    const req = request('/percy/snapshot', {
      method: 'POST',
      body: { name: 'test', me_too: true, sync: true }
    });

    await expectAsync(req).toBeResolvedTo({
      success: true,
      data: getSnapshotDetailsResponse
    });

    expect(percy.client.getSnapshotDetails).toHaveBeenCalled();
    expect(percy.snapshot).toHaveBeenCalledOnceWith(
      { name: 'test', me_too: true, sync: true },
      jasmine.objectContaining({})
    );
  });

  it('can handle snapshots async with a parameter', async () => {
    let resolve, test = new Promise(r => (resolve = r));
    spyOn(percy, 'snapshot').and.returnValue(test);
    await percy.start();

    await expectAsync(
      request('/percy/snapshot?async', 'POST')
    ).toBeResolvedTo({
      success: true
    });

    await expectAsync(test).toBePending();
    resolve(); // no hanging promises
  });

  it('has a /comparison endpoint that calls #upload() async with provided options', async () => {
    let resolve, test = new Promise(r => (resolve = r));
    spyOn(percy, 'upload').and.returnValue(test);
    await percy.start();

    await expectAsync(request('/percy/comparison', {
      method: 'POST',
      body: { 'test-me': true, me_too: true }
    })).toBeResolvedTo(jasmine.objectContaining({
      success: true
    }));

    expect(percy.upload).toHaveBeenCalledOnceWith(
      { 'test-me': true, me_too: true },
      null,
      'app'
    );

    await expectAsync(test).toBePending();
    resolve(); // no hanging promises
  });

  it('has a /comparison endpoint that calls #upload() with sync mode', async () => {
    spyOn(percy.client, 'getComparisonDetails').and.returnValue(getSnapshotDetailsResponse);
    spyOn(percy, 'upload').and.callFake((_, callback) => callback.resolve());
    await percy.start();

    await expectAsync(request('/percy/comparison', {
      method: 'POST',
      body: {
        name: 'Snapshot name',
        sync: true,
        tag: {
          name: 'Tag name',
          osName: 'OS name',
          osVersion: 'OS version',
          width: 800,
          height: 1280,
          orientation: 'landscape'
        }
      }
    })).toBeResolvedTo(jasmine.objectContaining({
      data: getSnapshotDetailsResponse,
      link: `${percy.client.apiUrl}/comparisons/redirect?${[
        'build_id=123',
        'snapshot[name]=Snapshot%20name',
        'tag[name]=Tag%20name',
        'tag[os_name]=OS%20name',
        'tag[os_version]=OS%20version',
        'tag[width]=800',
        'tag[height]=1280',
        'tag[orientation]=landscape'
      ].join('&')}`
    }));

    expect(percy.client.getComparisonDetails).toHaveBeenCalled();
  });

  // Regression: percy.upload() is the generatePromise-wrapped method and returns a Promise,
  // not an async iterable. The relay must drive it and let the sync queue resolve the
  // attached callback — it must never `for await` the return value (that throws
  // "upload is not async iterable"). Modelled with the real shape: a Promise return whose
  // callback is resolved asynchronously, so a `for await` over it would reject first.
  it('/comparison sync mode: resolves via the upload callback, not by iterating the return value', async () => {
    spyOn(percy.client, 'getComparisonDetails').and.returnValue(getSnapshotDetailsResponse);
    spyOn(percy, 'upload').and.callFake((_, callback) => {
      let promise = Promise.resolve();
      promise.then(() => callback.resolve());
      return promise;
    });
    await percy.start();

    await expectAsync(request('/percy/comparison', {
      method: 'POST',
      body: {
        name: 'Sync regression',
        sync: true,
        tag: { name: 'Tag', osName: 'OS', osVersion: '1', width: 1, height: 1, orientation: 'portrait' }
      }
    })).toBeResolvedTo(jasmine.objectContaining({ data: getSnapshotDetailsResponse }));

    expect(percy.upload).toHaveBeenCalledOnceWith(
      jasmine.objectContaining({ name: 'Sync regression' }), jasmine.objectContaining({}), 'app');
    // Proves handleSyncJob ran to completion rather than the request resolving early.
    expect(percy.client.getComparisonDetails).toHaveBeenCalled();
  });

  // A generator-level failure that bypasses the sync-queue callback (the upload Promise
  // rejects without resolve/reject being invoked) must surface as data.error via the
  // route's .catch(reject), not hang the request.
  it('/comparison sync mode: surfaces a rejected upload Promise as data.error', async () => {
    spyOn(percy, 'upload').and.callFake(() => Promise.reject(new Error('generator boom')));
    await percy.start();

    await expectAsync(request('/percy/comparison', {
      method: 'POST',
      body: {
        name: 'Sync reject',
        sync: true,
        tag: { name: 'Tag', osName: 'OS', osVersion: '1', width: 1, height: 1, orientation: 'portrait' }
      }
    })).toBeResolvedTo(jasmine.objectContaining({ data: { error: 'generator boom' } }));
  });

  it('includes links in the /comparison endpoint response', async () => {
    spyOn(percy, 'upload').and.resolveTo();
    await percy.start();

    await expectAsync(request('/percy/comparison', {
      method: 'POST',
      body: {
        name: 'Snapshot name',
        tag: {
          name: 'Tag name',
          osName: 'OS name',
          osVersion: 'OS version',
          width: 800,
          height: 1280,
          orientation: 'landscape'
        }
      }
    })).toBeResolvedTo(jasmine.objectContaining({
      link: `${percy.client.apiUrl}/comparisons/redirect?${[
        'build_id=123',
        'snapshot[name]=Snapshot%20name',
        'tag[name]=Tag%20name',
        'tag[os_name]=OS%20name',
        'tag[os_version]=OS%20version',
        'tag[width]=800',
        'tag[height]=1280',
        'tag[orientation]=landscape'
      ].join('&')}`
    }));

    await expectAsync(request('/percy/comparison', {
      method: 'POST',
      body: [
        { name: 'Snapshot 1', tag: { name: 'Tag 1' } },
        { name: 'Snapshot 2', tag: { name: 'Tag 2' } }
      ]
    })).toBeResolvedTo(jasmine.objectContaining({
      links: [
        `${percy.client.apiUrl}/comparisons/redirect?${[
          'build_id=123',
          'snapshot[name]=Snapshot%201',
          'tag[name]=Tag%201'
        ].join('&')}`,
        `${percy.client.apiUrl}/comparisons/redirect?${[
          'build_id=123',
          'snapshot[name]=Snapshot%202',
          'tag[name]=Tag%202'
        ].join('&')}`
      ]
    }));
  });

  it('can wait on comparisons to finish uploading with a parameter', async () => {
    let resolve, test = new Promise(r => (resolve = r));

    spyOn(percy, 'upload').and.returnValue(test);
    await percy.start();

    let pending = expectAsync(
      request('/percy/comparison?await', 'POST')
    ).toBeResolvedTo({
      success: true
    });

    await new Promise(r => setTimeout(r, 50));
    expect(percy.upload).toHaveBeenCalled();

    await expectAsync(test).toBePending();
    await expectAsync(pending).toBePending();

    resolve();

    await expectAsync(test).toBeResolved();
    await expectAsync(pending).toBeResolved();
  });

  it('has a /automateScreenshot endpoint that calls #upload() async with provided options', async () => {
    let resolve, test = new Promise(r => (resolve = r));
    spyOn(percy, 'upload').and.returnValue(test);
    let mockWebdriverUtilResponse = 'TODO: mocked response';
    let captureScreenshotSpy = spyOn(WebdriverUtils, 'captureScreenshot').and.resolveTo(mockWebdriverUtilResponse);

    await percy.start();

    percy.config.snapshot.fullPage = false;
    percy.config.snapshot.percyCSS = '.global { color: blue }';
    percy.config.snapshot.freezeAnimatedImage = false;
    percy.config.snapshot.freezeAnimatedImageOptions = { freezeImageByXpaths: ['/xpath-global'] };
    percy.config.snapshot.ignoreRegions = { ignoreRegionSelectors: ['.selector-global'] };
    percy.config.snapshot.considerRegions = { considerRegionXpaths: ['/xpath-global'] };

    await expectAsync(request('/percy/automateScreenshot', {
      body: {
        name: 'Snapshot name',
        client_info: 'client',
        environment_info: 'environment',
        options: {
          fullPage: true,
          percyCSS: '.percy-screenshot: { color: red }',
          freeze_animated_image: true,
          freezeImageBySelectors: ['.selector-per-screenshot'],
          ignore_region_xpaths: ['/xpath-per-screenshot'],
          consider_region_xpaths: ['/xpath-per-screenshot'],
          testCase: 'random test case',
          thTestCaseExecutionId: 'random uuid'
        }
      },
      method: 'post'
    })).toBeResolvedTo({ success: true });

    expect(captureScreenshotSpy).toHaveBeenCalledOnceWith(jasmine.objectContaining({
      clientInfo: 'client',
      environmentInfo: 'environment',
      buildInfo: { id: '123', url: 'https://percy.io/test/test/123', number: 1 },
      options: {
        fullPage: true,
        freezeAnimatedImage: true,
        freezeImageBySelectors: ['.selector-per-screenshot'],
        freezeImageByXpaths: ['/xpath-global'],
        percyCSS: '.global { color: blue }\n.percy-screenshot: { color: red }',
        ignoreRegionSelectors: ['.selector-global'],
        ignoreRegionXpaths: ['/xpath-per-screenshot'],
        considerRegionXpaths: ['/xpath-global', '/xpath-per-screenshot'],
        version: 'v2',
        testCase: 'random test case',
        thTestCaseExecutionId: 'random uuid'
      }
    }));

    expect(percy.upload).toHaveBeenCalledOnceWith(mockWebdriverUtilResponse, null, 'automate');
    await expectAsync(test).toBePending();
    resolve(); // no hanging promises
  });

  it('has a /automateScreenshot endpoint that calls #upload() async with provided options', async () => {
    spyOn(percy.client, 'getComparisonDetails').and.returnValue(getSnapshotDetailsResponse);
    spyOn(percy, 'upload').and.callFake((_, callback) => callback.resolve());
    let captureScreenshotSpy = spyOn(WebdriverUtils, 'captureScreenshot').and.returnValue({ sync: true });

    await percy.start();

    percy.config.snapshot.fullPage = false;

    percy.config.snapshot.percyCSS = '.global { color: blue }';
    percy.config.snapshot.freezeAnimatedImage = false;
    percy.config.snapshot.freezeAnimatedImageOptions = { freezeImageByXpaths: ['/xpath-global'] };
    percy.config.snapshot.ignoreRegions = { ignoreRegionSelectors: ['.selector-global'] };
    percy.config.snapshot.considerRegions = { considerRegionXpaths: ['/xpath-global'] };

    await expectAsync(request('/percy/automateScreenshot', {
      body: {
        name: 'Snapshot name',
        client_info: 'client',
        environment_info: 'environment',
        options: {
          sync: true,
          fullPage: true,
          percyCSS: '.percy-screenshot: { color: red }',
          freeze_animated_image: true,
          freezeImageBySelectors: ['.selector-per-screenshot'],
          ignore_region_xpaths: ['/xpath-per-screenshot'],
          consider_region_xpaths: ['/xpath-per-screenshot']
        }
      },
      method: 'post'
    })).toBeResolvedTo({ success: true, data: getSnapshotDetailsResponse });

    expect(captureScreenshotSpy).toHaveBeenCalledOnceWith(jasmine.objectContaining({
      clientInfo: 'client',
      environmentInfo: 'environment',
      buildInfo: { id: '123', url: 'https://percy.io/test/test/123', number: 1 },
      options: {
        sync: true,
        fullPage: true,
        freezeAnimatedImage: true,
        freezeImageBySelectors: ['.selector-per-screenshot'],
        freezeImageByXpaths: ['/xpath-global'],
        percyCSS: '.global { color: blue }\n.percy-screenshot: { color: red }',
        ignoreRegionSelectors: ['.selector-global'],
        ignoreRegionXpaths: ['/xpath-per-screenshot'],
        considerRegionXpaths: ['/xpath-global', '/xpath-per-screenshot'],
        version: 'v2'
      }
    }));

    expect(percy.client.getComparisonDetails).toHaveBeenCalled();
    expect(percy.upload).toHaveBeenCalledOnceWith({ sync: true }, jasmine.objectContaining({}), 'automate');
  });

  it('has a /automateScreenshot endpoint that propagates labels through to #upload()', async () => {
    let resolve, test = new Promise(r => (resolve = r));
    spyOn(percy, 'upload').and.returnValue(test);
    // Simulate what the real WebdriverUtils.captureScreenshot does:
    // it must copy options.labels onto the returned comparisonData.
    let captureScreenshotSpy = spyOn(WebdriverUtils, 'captureScreenshot').and.callFake(({ options }) => {
      return Promise.resolve({
        name: 'Snapshot name',
        tag: { name: 'tag-1' },
        tiles: [],
        metadata: {},
        sync: options.sync,
        testCase: options.testCase,
        labels: options.labels,
        thTestCaseExecutionId: options.thTestCaseExecutionId
      });
    });

    await percy.start();

    await expectAsync(request('/percy/automateScreenshot', {
      body: {
        name: 'Snapshot name',
        client_info: 'client',
        environment_info: 'environment',
        options: {
          labels: 'qa,smoke',
          testCase: 'tc-1',
          thTestCaseExecutionId: 'exec-99'
        }
      },
      method: 'post'
    })).toBeResolvedTo({ success: true });

    expect(captureScreenshotSpy).toHaveBeenCalledOnceWith(jasmine.objectContaining({
      options: jasmine.objectContaining({
        labels: 'qa,smoke',
        testCase: 'tc-1',
        thTestCaseExecutionId: 'exec-99'
      })
    }));

    expect(percy.upload).toHaveBeenCalledOnceWith(
      jasmine.objectContaining({
        labels: 'qa,smoke',
        testCase: 'tc-1',
        thTestCaseExecutionId: 'exec-99'
      }),
      null,
      'automate'
    );

    resolve();
  });

  // Regression mirror of the /comparison case for the Percy-on-Automate sync route:
  // percy.upload() returns a Promise, so the relay must resolve through the sync callback
  // rather than `for await`-ing the return value ("upload is not async iterable").
  it('/automateScreenshot sync mode: resolves via the upload callback, not by iterating the return value', async () => {
    spyOn(percy.client, 'getComparisonDetails').and.returnValue(getSnapshotDetailsResponse);
    spyOn(WebdriverUtils, 'captureScreenshot').and.returnValue({ sync: true });
    spyOn(percy, 'upload').and.callFake((_, callback) => {
      let promise = Promise.resolve();
      promise.then(() => callback.resolve());
      return promise;
    });
    await percy.start();

    await expectAsync(request('/percy/automateScreenshot', {
      method: 'post',
      body: {
        name: 'Sync regression',
        client_info: 'client',
        environment_info: 'environment',
        options: { sync: true }
      }
    })).toBeResolvedTo(jasmine.objectContaining({ data: getSnapshotDetailsResponse }));

    expect(percy.upload).toHaveBeenCalledOnceWith({ sync: true }, jasmine.objectContaining({}), 'automate');
    // Proves handleSyncJob ran to completion rather than the request resolving early.
    expect(percy.client.getComparisonDetails).toHaveBeenCalled();
  });

  it('has a /events endpoint that calls #sendBuildEvents() async with provided options with clientInfo present', async () => {
    let { getPackageJSON } = await import('@percy/client/utils');
    let pkg = getPackageJSON(import.meta.url);
    let resolve, test = new Promise(r => (resolve = r));
    let sendBuildEventsSpy = spyOn(percy.client, 'sendBuildEvents').and.resolveTo('some response');

    await percy.start();

    await expectAsync(request('/percy/events', {
      body: {
        message: 'some error',
        clientInfo: 'percy-appium-dotnet/3.0.1'
      },
      method: 'post'
    })).toBeResolvedTo({ success: true });

    expect(sendBuildEventsSpy).toHaveBeenCalledOnceWith(percy.build.id, jasmine.objectContaining({
      message: 'some error',
      client: 'percy-appium-dotnet',
      clientVersion: '3.0.1',
      cliVersion: pkg.version
    }));

    await expectAsync(test).toBePending();
    resolve(); // no hanging promises
  });

  it('has a /events endpoint called with body array that calls #sendBuildEvents() async with provided options with clientInfo present', async () => {
    let { getPackageJSON } = await import('@percy/client/utils');
    let pkg = getPackageJSON(import.meta.url);
    let resolve, test = new Promise(r => (resolve = r));
    let sendBuildEventsSpy = spyOn(percy.client, 'sendBuildEvents').and.resolveTo('some response');

    await percy.start();

    await expectAsync(request('/percy/events', {
      body: [
        {
          message: 'some error 1',
          clientInfo: 'percy-appium-dotnet/3.0.1'
        },
        {
          message: 'some error 2',
          clientInfo: 'percy-appium-dotnet/3.0.1'
        }
      ],
      method: 'post'
    })).toBeResolvedTo({ success: true });

    expect(sendBuildEventsSpy).toHaveBeenCalledOnceWith(percy.build.id, jasmine.objectContaining(
      [
        {
          message: 'some error 1',
          client: 'percy-appium-dotnet',
          clientVersion: '3.0.1',
          cliVersion: pkg.version
        },
        {
          message: 'some error 2',
          client: 'percy-appium-dotnet',
          clientVersion: '3.0.1',
          cliVersion: pkg.version

        }
      ]
    ));

    await expectAsync(test).toBePending();
    resolve(); // no hanging promises
  });

  it('has a /events endpoint that calls #sendBuildEvents() async with provided options with clientInfo absent', async () => {
    let resolve, test = new Promise(r => (resolve = r));
    let sendBuildEventsSpy = spyOn(percy.client, 'sendBuildEvents').and.resolveTo('some response');

    await percy.start();

    await expectAsync(request('/percy/events', {
      body: {
        message: 'some error',
        cliVersion: '1.2.3'
      },
      method: 'post'
    })).toBeResolvedTo({ success: true });

    expect(sendBuildEventsSpy).toHaveBeenCalledOnceWith(percy.build.id, jasmine.objectContaining({
      message: 'some error',
      cliVersion: '1.2.3'
    }));

    await expectAsync(test).toBePending();
    resolve(); // no hanging promises
  });

  it('has a /log endpoint that adds sdk log to logger', async () => {
    await percy.start();

    const message1 = {
      level: 'info',
      message: 'some info',
      meta: { snapshot: 'Snapshot name', testCase: 'testCase name' }
    };

    const message2 = {
      level: 'error',
      message: 'some error',
      meta: { snapshot: 'Snapshot name 2', testCase: 'testCase name' }
    };

    // works with standard messages
    await expectAsync(request('/percy/log', {
      body: message1,
      method: 'post'
    })).toBeResolvedTo({ success: true });

    await expectAsync(request('/percy/log', {
      body: message2,
      method: 'post'
    })).toBeResolvedTo({ success: true });

    // works without meta
    await expectAsync(request('/percy/log', {
      body: {
        level: 'info',
        message: 'some other info'
      },
      method: 'post'
    })).toBeResolvedTo({ success: true });

    // throws error on invalid data
    await expectAsync(request('/percy/log', {
      body: null,
      method: 'post'
    })).toBeRejected();

    const sdkLogs = logger.instance.query(log => log.debug === 'sdk');

    expect(sdkLogs.length).toEqual(4);

    expect(sdkLogs[0].level).toEqual(message1.level);
    expect(sdkLogs[0].message).toEqual(message1.message);
    expect(sdkLogs[0].meta).toEqual(message1.meta);

    expect(sdkLogs[1].level).toEqual(message2.level);
    expect(sdkLogs[1].message).toEqual(message2.message);
    expect(sdkLogs[1].meta).toEqual(message2.meta);
  });

  it('returns a 500 error when an endpoint throws', async () => {
    spyOn(percy, 'snapshot').and.rejectWith(new Error('test error'));
    await percy.start();

    let [data, res] = await request('/percy/snapshot', 'POST', true);
    expect(res.statusCode).toBe(500);
    expect(data).toEqual({
      build: percy.build,
      error: 'test error',
      success: false
    });
  });

  it('returns a 404 for any other endpoint', async () => {
    await percy.start();

    let [data, res] = await request('/foobar', true);
    expect(res.statusCode).toBe(404);
    expect(data).toEqual({
      build: percy.build,
      error: 'Not Found',
      success: false
    });
  });

  describe('when the server is disabled', () => {
    beforeEach(async () => {
      percy = await Percy.start({
        token: 'PERCY_TOKEN',
        server: false
      });
    });

    it('does not start a server with #start()', async () => {
      await expectAsync(request('http://localhost:5883'))
        .toBeRejectedWithError(/ECONNREFUSED/);
    });

    it('does not error when stopping', async () => {
      await expectAsync(percy.stop()).toBeResolved();
    });
  });

  describe('when testing mode is enabled', () => {
    const addr = 'http://localhost:5338';
    const get = p => request(`${addr}${p}`);
    const post = (p, body) => request(`${addr}${p}`, { method: 'post', body });
    const req = p => request(`${addr}${p}`, { retries: 0 }, false);

    beforeEach(async () => {
      process.env.PERCY_TOKEN = 'TEST_TOKEN';
      percy = await Percy.start({ testing: true });
      logger.instance.reset();
    });

    afterEach(() => {
      delete process.env.PERCY_TOKEN;
    });

    it('implies loglevel silent and dryRun', () => {
      expect(percy.testing).toBeDefined();
      expect(percy.loglevel()).toEqual('silent');
      expect(percy.dryRun).toBeTrue();
    });

    it('enables a /test/snapshot endpoint that serves a simple html document', async () => {
      await expectAsync(get('/test/snapshot')).toBeResolvedTo('<p>Snapshot Me!</p>');
    });

    it('enables a /test/logs endpoint to return raw logs', async () => {
      percy.log.info('foo bar from test');
      let { logs } = await get('/test/logs');

      expect(logs).toEqual(jasmine.arrayContaining([
        jasmine.objectContaining({ message: 'foo bar from test' })
      ]));
    });

    it('enables a /test/requests endpoint to return tracked requests', async () => {
      // should not track testing mode requests
      await get('/percy/healthcheck');
      await get('/test/snapshot');
      await post('/percy/config', { clientInfo: 'foo/bar' });
      await get('/test/logs');
      await get('/percy/idle?param');

      let { requests } = await get('/test/requests');

      expect(requests).toEqual([
        { method: 'GET', url: '/percy/healthcheck' },
        { method: 'POST', url: '/percy/config', body: { clientInfo: 'foo/bar' } },
        { method: 'GET', url: '/percy/idle?param' }
      ]);
    });

    it('enables several /test/api endpoint commands', async () => {
      expect(percy.testing).toEqual({});
      await post('/test/api/version', false);
      expect(percy.testing).toHaveProperty('version', false);
      await post('/test/api/version', '0.0.1');
      expect(percy.testing).toHaveProperty('version', '0.0.1');
      await post('/test/api/reset');
      expect(percy.testing).toEqual({});
      await post('/test/api/build-failure');
      expect(percy.testing).toHaveProperty('build', { failed: true, error: 'Build failed' });
      await post('/test/api/build-created');
      expect(percy.testing).toHaveProperty('build', { id: '123', url: 'https://percy.io/test/test/123' });
      await post('/test/api/error', '/percy/healthcheck');
      expect(percy.testing).toHaveProperty('api', { '/percy/healthcheck': 'error' });
      await post('/test/api/disconnect', '/percy/healthcheck');
      expect(percy.testing).toHaveProperty('api', { '/percy/healthcheck': 'disconnect' });
      await expectAsync(post('/test/api/foobar')).toBeRejectedWithError('404 Not Found');
    });

    it('can manipulate the version header via /test/api/version', async () => {
      let { headers } = await req('/percy/healthcheck');
      expect(headers['x-percy-core-version']).toBeDefined();

      await post('/test/api/version', false);
      ({ headers } = await req('/percy/healthcheck'));
      expect(headers['x-percy-core-version']).toBeUndefined();

      await post('/test/api/version', '0.0.1');
      ({ headers } = await req('/percy/healthcheck'));
      expect(headers['x-percy-core-version']).toEqual('0.0.1');
    });

    it('can manipulate the config widths via /test/api/config', async () => {
      let { widths, config, deviceDetails } = await get('/percy/healthcheck');
      expect(widths.config).toEqual([375, 1280]);
      expect(widths.mobile).toEqual([]);
      expect(deviceDetails).toEqual([]);

      await post('/test/api/config', { config: [390], deferUploads: true });
      ({ widths, config, deviceDetails } = await get('/percy/healthcheck'));
      expect(widths.config).toEqual([390]);
      expect(config.snapshot.responsiveSnapshotCapture).toEqual(false);
      expect(config.percy.deferUploads).toEqual(true);
      expect(deviceDetails).toEqual([]);

      await post('/test/api/config', { config: [375, 1280], mobile: [456], responsive: true });
      ({ widths, config, deviceDetails } = await get('/percy/healthcheck'));
      expect(widths.mobile).toEqual([456]);
      expect(config.snapshot.responsiveSnapshotCapture).toEqual(true);
      expect(config.percy.deferUploads).toEqual(false);
      expect(deviceDetails).toEqual([{ width: 456 }]);
    });

    it('can make endpoints return server errors via /test/api/error', async () => {
      let { statusCode } = await req('/percy/healthcheck');
      expect(statusCode).toEqual(200);

      await post('/test/api/error', '/percy/healthcheck');
      ({ statusCode } = await req('/percy/healthcheck'));
      expect(statusCode).toEqual(500);
    });

    it('can make endpoints return a build failure via /test/api/build-failure', async () => {
      let expected = { failed: true, error: 'Build failed' };
      let { build } = await get('/percy/healthcheck');
      expect(build).toBeUndefined();

      await post('/test/api/build-failure');
      ({ build } = await get('/percy/healthcheck'));
      expect(build).toEqual(expected);

      // errors include build info
      await post('/test/api/error', '/percy/snapshot');
      let { body: snapshot } = await req('/percy/snapshot');
      expect(snapshot).toHaveProperty('error', expected.error);
      expect(snapshot).toHaveProperty('build', expected);
    });

    it('can make endpoints destroy connections via /test/api/disconnect', async () => {
      await expectAsync(req('/percy/healthcheck')).toBeResolved();
      await post('/test/api/disconnect', '/percy/healthcheck');
      await expectAsync(req('/percy/healthcheck')).toBeRejected();
    });

    it('can reset testing mode and clear logs via /test/reset', async () => {
      // already tested up above
      await post('/test/api/version', false);
      await post('/test/api/disconnect', '/percy/healthcheck');

      // the actual endpoint to test
      await post('/test/api/reset');

      // everything should work as usual
      let { headers } = await req('/percy/healthcheck');
      expect(headers['x-percy-core-version']).toBeDefined();

      // logs should be empty after reset
      let { logs } = await get('/test/logs');
      expect(logs).toEqual([]);
    });
  });

  describe('/percy/widths-config', () => {
    it('returns widths with heights for mobile devices and without heights for user widths', async () => {
      await percy.start();
      percy.deviceDetails = [
        { width: 390, height: 844 },
        { width: 428, height: 926 }
      ];
      percy.config.snapshot.widths = [1280];

      await expectAsync(
        request('/percy/widths-config?widths=375,1920')
      ).toBeResolvedTo({
        success: true,
        widths: [
          { width: 375 },
          { width: 390, height: 844 },
          { width: 428, height: 926 },
          { width: 1920 }
        ]
      });
    });

    it('returns config widths when no user widths are passed', async () => {
      await percy.start();
      percy.deviceDetails = [
        { width: 375, height: 667 }
      ];
      percy.config.snapshot.widths = [1280, 1920];

      await expectAsync(
        request('/percy/widths-config')
      ).toBeResolvedTo({
        success: true,
        widths: [
          { width: 375, height: 667 },
          { width: 1280 },
          { width: 1920 }
        ]
      });
    });

    it('returns only user widths when no mobile devices exist', async () => {
      await percy.start();
      percy.deviceDetails = [];
      percy.config.snapshot.widths = [1280];

      await expectAsync(
        request('/percy/widths-config?widths=375,1920')
      ).toBeResolvedTo({
        success: true,
        widths: [
          { width: 375 },
          { width: 1920 }
        ]
      });
    });

    it('returns widths sorted in ascending order', async () => {
      await percy.start();
      percy.deviceDetails = [
        { width: 428, height: 926 },
        { width: 390, height: 844 }
      ];
      percy.config.snapshot.widths = [1280];

      await expectAsync(
        request('/percy/widths-config?widths=1920,375')
      ).toBeResolvedTo({
        success: true,
        widths: [
          { width: 375 },
          { width: 390, height: 844 },
          { width: 428, height: 926 },
          { width: 1920 }
        ]
      });
    });

    it('filters out invalid widths from query parameters', async () => {
      await percy.start();
      percy.deviceDetails = [];
      percy.config.snapshot.widths = [1280];

      await expectAsync(
        request('/percy/widths-config?widths=375,abc,1920,def,')
      ).toBeResolvedTo({
        success: true,
        widths: [
          { width: 375 },
          { width: 1920 }
        ]
      });
    });

    it('does not duplicate widths when user width matches device width', async () => {
      await percy.start();
      percy.deviceDetails = [
        { width: 375, height: 667 }
      ];
      percy.config.snapshot.widths = [1280];

      await expectAsync(
        request('/percy/widths-config?widths=375,1280')
      ).toBeResolvedTo({
        success: true,
        widths: [
          { width: 375 },
          { width: 1280 }
        ]
      });
    });

    it('handles devices without height property', async () => {
      await percy.start();
      percy.deviceDetails = [
        { width: 375, height: 667 },
        { width: 390 } // no height
      ];
      percy.config.snapshot.widths = [1280];

      await expectAsync(
        request('/percy/widths-config?widths=1920')
      ).toBeResolvedTo({
        success: true,
        widths: [
          { width: 375, height: 667 },
          { width: 1920 }
        ]
      });
    });

    it('returns only config widths when no device details and no user widths', async () => {
      await percy.start();
      percy.deviceDetails = [];
      percy.config.snapshot.widths = [375, 1280];

      await expectAsync(
        request('/percy/widths-config')
      ).toBeResolvedTo({
        success: true,
        widths: [
          { width: 375 },
          { width: 1280 }
        ]
      });
    });

    it('handles empty widths query parameter', async () => {
      await percy.start();
      percy.deviceDetails = [
        { width: 390, height: 844 }
      ];
      percy.config.snapshot.widths = [1280];

      await expectAsync(
        request('/percy/widths-config?widths=')
      ).toBeResolvedTo({
        success: true,
        widths: [
          { width: 390, height: 844 },
          { width: 1280 }
        ]
      });
    });

    it('handles null deviceDetails', async () => {
      await percy.start();
      percy.deviceDetails = null;
      percy.config.snapshot.widths = [375, 1280];

      await expectAsync(
        request('/percy/widths-config?widths=1920')
      ).toBeResolvedTo({
        success: true,
        widths: [
          { width: 1920 }
        ]
      });
    });

    it('handles undefined deviceDetails', async () => {
      await percy.start();
      percy.deviceDetails = undefined;
      percy.config.snapshot.widths = [375, 1280];

      await expectAsync(
        request('/percy/widths-config')
      ).toBeResolvedTo({
        success: true,
        widths: [
          { width: 375 },
          { width: 1280 }
        ]
      });
    });
  });

  describe('/percy/maestro-screenshot', () => {
    const SID = 'testsession';
    const SS_NAME = 'HomeScreen';
    const ANDROID_DIR = `/tmp/${SID}_test_suite/logs/run1/screenshots`;
    const IOS_DIR = `/tmp/${SID}/emu_maestro_debug_abc/flow_x`;
    // New SDK convention (filePath path): /tmp/<sid>{_test_suite}/percy/<name>.png
    const ANDROID_FILEPATH_DIR = `/tmp/${SID}_test_suite/percy`;
    const IOS_FILEPATH_DIR = `/tmp/${SID}/percy`;
    const FILEPATH_NAME = 'FromFilePath';

    beforeEach(async () => {
      fs.mkdirSync(ANDROID_DIR, { recursive: true });
      fs.writeFileSync(path.join(ANDROID_DIR, `${SS_NAME}.png`), 'PNGBYTES-ANDROID');
      fs.mkdirSync(IOS_DIR, { recursive: true });
      // iOS element-region path parses IHDR off the buffer — write a minimal
      // 24-byte valid PNG header (1170 × 2532 iPhone 14 portrait) instead of a
      // string sentinel. Android path doesn't parse, so the string sentinel is fine.
      const pngHeader = Buffer.alloc(24);
      Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]).copy(pngHeader, 0);
      pngHeader.writeUInt32BE(13, 8);
      Buffer.from('IHDR', 'ascii').copy(pngHeader, 12);
      pngHeader.writeUInt32BE(1170, 16);
      pngHeader.writeUInt32BE(2532, 20);
      fs.writeFileSync(path.join(IOS_DIR, `${SS_NAME}.png`), pngHeader);

      // filePath fixtures — same per-platform session root, but a different
      // subdirectory than the legacy glob. Exercises the new SDK path
      // independently from the back-compat glob.
      fs.mkdirSync(ANDROID_FILEPATH_DIR, { recursive: true });
      fs.writeFileSync(path.join(ANDROID_FILEPATH_DIR, `${FILEPATH_NAME}.png`), 'PNGBYTES-FILEPATH-ANDROID');
      fs.mkdirSync(IOS_FILEPATH_DIR, { recursive: true });
      fs.writeFileSync(path.join(IOS_FILEPATH_DIR, `${FILEPATH_NAME}.png`), 'PNGBYTES-FILEPATH-IOS');

      // Short-circuit device system-bar inset derivation in the unit env (no
      // real device/adb): seeding the per-session cache makes the relay skip
      // deriveDeviceInsets and fall back to the request's statusBarHeight/
      // navBarHeight. Tests that assert derived behavior override this seed.
      percy.maestroInsetCache.set(SID, null);
    });

    async function postMaestro(body) {
      return request('/percy/maestro-screenshot', { method: 'POST', body });
    }

    it('rejects missing name with 400', async () => {
      await percy.start();
      await expectAsync(postMaestro({ sessionId: SID })).toBeRejectedWithError(/Missing required field: name/);
    });

    it('400s missing sessionId + missing PERCY_MAESTRO_SCREENSHOT_DIR (self-hosted mode requires the env var)', async () => {
      // `sessionId` absent is the self-hosted detection signal. Without
      // PERCY_MAESTRO_SCREENSHOT_DIR set, the relay 400s with actionable
      // guidance rather than 404'ing on a glob it cannot scope. The
      // self-hosted happy path is covered in the dedicated describe below.
      let prior = process.env.PERCY_MAESTRO_SCREENSHOT_DIR;
      delete process.env.PERCY_MAESTRO_SCREENSHOT_DIR;
      try {
        await percy.start();
        await expectAsync(postMaestro({ name: SS_NAME }))
          .toBeRejectedWithError(/Missing required env: PERCY_MAESTRO_SCREENSHOT_DIR/);
      } finally {
        if (prior === undefined) delete process.env.PERCY_MAESTRO_SCREENSHOT_DIR;
        else process.env.PERCY_MAESTRO_SCREENSHOT_DIR = prior;
      }
    });

    it('rejects invalid platform with 400', async () => {
      await percy.start();
      await expectAsync(postMaestro({ name: SS_NAME, sessionId: SID, platform: 'web' }))
        .toBeRejectedWithError(/Invalid platform/);
    });

    it('rejects non-SAFE_ID screenshot name with 400', async () => {
      await percy.start();
      await expectAsync(postMaestro({ name: '../etc/passwd', sessionId: SID }))
        .toBeRejectedWithError(/Invalid screenshot name/);
    });

    it('rejects non-SAFE_ID sessionId with 400', async () => {
      await percy.start();
      await expectAsync(postMaestro({ name: SS_NAME, sessionId: 'bad/sid' }))
        .toBeRejectedWithError(/Invalid sessionId/);
    });

    it('rejects non-string platform type with 400', async () => {
      await percy.start();
      await expectAsync(postMaestro({ name: SS_NAME, sessionId: SID, platform: 123 }))
        .toBeRejectedWithError(/Invalid platform: must be a string/);
    });

    it('rejects non-object element selector with 400', async () => {
      await percy.start();
      await expectAsync(postMaestro({
        name: SS_NAME,
        sessionId: SID,
        regions: [{ element: 'not-an-object' }]
      })).toBeRejectedWithError(/element must be an object/);
    });

    it('rejects non-array regions with 400', async () => {
      await percy.start();
      await expectAsync(postMaestro({ name: SS_NAME, sessionId: SID, regions: 'not-array' }))
        .toBeRejectedWithError(/regions must be an array/);
    });

    it('rejects too-many regions with 400', async () => {
      await percy.start();
      let regions = new Array(51).fill({ top: 0, bottom: 10, left: 0, right: 10 });
      await expectAsync(postMaestro({ name: SS_NAME, sessionId: SID, regions }))
        .toBeRejectedWithError(/regions exceeds maximum of 50/);
    });

    it('rejects element region with unsupported selector key', async () => {
      await percy.start();
      await expectAsync(postMaestro({
        name: SS_NAME,
        sessionId: SID,
        platform: 'android',
        regions: [{ element: { xpath: '//foo' }, algorithm: 'ignore' }]
      })).toBeRejectedWithError(/unsupported selector key/);
    });

    it('rejects element region with multiple selector keys', async () => {
      await percy.start();
      await expectAsync(postMaestro({
        name: SS_NAME,
        sessionId: SID,
        platform: 'android',
        regions: [{ element: { 'resource-id': 'a', text: 'b' } }]
      })).toBeRejectedWithError(/exactly one selector key/);
    });

    it('rejects element selector value longer than 512 chars', async () => {
      await percy.start();
      await expectAsync(postMaestro({
        name: SS_NAME,
        sessionId: SID,
        platform: 'android',
        regions: [{ element: { 'resource-id': 'a'.repeat(513) } }]
      })).toBeRejectedWithError(/exceeds maximum length of 512/);
    });

    it('rejects element region with empty selector value', async () => {
      await percy.start();
      await expectAsync(postMaestro({
        name: SS_NAME,
        sessionId: SID,
        platform: 'android',
        regions: [{ element: { 'resource-id': '' } }]
      })).toBeRejectedWithError(/must be a non-empty string/);
    });

    // ignoreRegions / considerRegions — parallel top-level inputs that emit
    // to payload.ignoredElementsData.ignoreElementsData[] and
    // payload.consideredElementsData.considerElementsData[]. Same per-item
    // shape and validation as regions[]; algorithm is implicit.

    it('rejects non-array ignoreRegions with 400', async () => {
      await percy.start();
      await expectAsync(postMaestro({ name: SS_NAME, sessionId: SID, ignoreRegions: 'nope' }))
        .toBeRejectedWithError(/ignoreRegions must be an array/);
    });

    it('rejects non-array considerRegions with 400', async () => {
      await percy.start();
      await expectAsync(postMaestro({ name: SS_NAME, sessionId: SID, considerRegions: {} }))
        .toBeRejectedWithError(/considerRegions must be an array/);
    });

    it('rejects too-many ignoreRegions with 400', async () => {
      await percy.start();
      let ignoreRegions = new Array(51).fill({ top: 0, bottom: 1, left: 0, right: 1 });
      await expectAsync(postMaestro({ name: SS_NAME, sessionId: SID, ignoreRegions }))
        .toBeRejectedWithError(/ignoreRegions exceeds maximum of 50/);
    });

    // Algorithm pass-through. The relay does NOT validate algorithm — the
    // downstream comparison schema enforces the enum
    // ('standard'|'layout'|'ignore'|'intelliignore') at upload time. Any
    // string the SDK supplies travels verbatim into payload.regions[].algorithm.
    // Tests below cover the default, a non-default valid value, and an
    // invalid value (relay still passes it through; backend rejects).

    it('regions[].algorithm passes through "ignore" verbatim', async () => {
      spyOn(percy, 'upload').and.resolveTo();
      await percy.start();
      await postMaestro({
        name: SS_NAME,
        sessionId: SID,
        platform: 'android',
        regions: [{ top: 0, bottom: 10, left: 0, right: 10, algorithm: 'ignore' }]
      });
      let [payload] = percy.upload.calls.mostRecent().args;
      expect(payload.regions[0].algorithm).toBe('ignore');
    });

    it('regions[].algorithm passes through "standard" verbatim', async () => {
      spyOn(percy, 'upload').and.resolveTo();
      await percy.start();
      await postMaestro({
        name: SS_NAME,
        sessionId: SID,
        platform: 'android',
        regions: [{ top: 0, bottom: 10, left: 0, right: 10, algorithm: 'standard' }]
      });
      let [payload] = percy.upload.calls.mostRecent().args;
      expect(payload.regions[0].algorithm).toBe('standard');
    });

    it('regions[].algorithm passes through invalid values verbatim (relay does not validate)', async () => {
      spyOn(percy, 'upload').and.resolveTo();
      await percy.start();
      await postMaestro({
        name: SS_NAME,
        sessionId: SID,
        platform: 'android',
        regions: [{ top: 0, bottom: 10, left: 0, right: 10, algorithm: 'bogus' }]
      });
      let [payload] = percy.upload.calls.mostRecent().args;
      expect(payload.regions[0].algorithm).toBe('bogus');
    });

    it('regions[].algorithm defaults to "ignore" when omitted', async () => {
      spyOn(percy, 'upload').and.resolveTo();
      await percy.start();
      await postMaestro({
        name: SS_NAME,
        sessionId: SID,
        platform: 'android',
        regions: [{ top: 0, bottom: 10, left: 0, right: 10 }]
      });
      let [payload] = percy.upload.calls.mostRecent().args;
      expect(payload.regions[0].algorithm).toBe('ignore');
    });

    it('accepts the boundary case of 50+50+50 = 150 total regions', async () => {
      spyOn(percy, 'upload').and.resolveTo();
      await percy.start();
      let one = { top: 0, bottom: 1, left: 0, right: 1 };
      await expectAsync(postMaestro({
        name: SS_NAME,
        sessionId: SID,
        platform: 'android',
        regions: new Array(50).fill(one),
        ignoreRegions: new Array(50).fill(one),
        considerRegions: new Array(50).fill(one)
      })).toBeResolvedTo(jasmine.objectContaining({ success: true }));
    });

    it('rejects ignoreRegions element selector value longer than 512 chars', async () => {
      await percy.start();
      await expectAsync(postMaestro({
        name: SS_NAME,
        sessionId: SID,
        platform: 'android',
        ignoreRegions: [{ element: { 'resource-id': 'a'.repeat(513) } }]
      })).toBeRejectedWithError(/exceeds maximum length of 512/);
    });

    it('emits coordinate ignoreRegions under payload.ignoredElementsData.ignoreElementsData', async () => {
      spyOn(percy, 'upload').and.resolveTo();
      await percy.start();

      await expectAsync(postMaestro({
        name: SS_NAME,
        sessionId: SID,
        platform: 'android',
        ignoreRegions: [{ top: 10, bottom: 60, left: 20, right: 80 }]
      })).toBeResolvedTo(jasmine.objectContaining({ success: true }));

      let [payload] = percy.upload.calls.mostRecent().args;
      expect(payload.ignoredElementsData).toEqual({
        ignoreElementsData: [{ coOrdinates: { top: 10, left: 20, bottom: 60, right: 80 } }]
      });
      expect(payload.consideredElementsData).toBeUndefined();
    });

    it('emits coordinate considerRegions under payload.consideredElementsData.considerElementsData', async () => {
      spyOn(percy, 'upload').and.resolveTo();
      await percy.start();

      await expectAsync(postMaestro({
        name: SS_NAME,
        sessionId: SID,
        platform: 'android',
        considerRegions: [{ top: 5, bottom: 15, left: 5, right: 25 }]
      })).toBeResolvedTo(jasmine.objectContaining({ success: true }));

      let [payload] = percy.upload.calls.mostRecent().args;
      expect(payload.consideredElementsData).toEqual({
        considerElementsData: [{ coOrdinates: { top: 5, left: 5, bottom: 15, right: 25 } }]
      });
      expect(payload.ignoredElementsData).toBeUndefined();
    });

    it('emits all three region inputs to three parallel payload fields', async () => {
      spyOn(percy, 'upload').and.resolveTo();
      await percy.start();

      await expectAsync(postMaestro({
        name: SS_NAME,
        sessionId: SID,
        platform: 'android',
        regions: [{ top: 0, bottom: 10, left: 0, right: 10, algorithm: 'ignore' }],
        ignoreRegions: [{ top: 20, bottom: 30, left: 20, right: 30 }],
        considerRegions: [{ top: 40, bottom: 50, left: 40, right: 50 }]
      })).toBeResolvedTo(jasmine.objectContaining({ success: true }));

      let [payload] = percy.upload.calls.mostRecent().args;
      expect(payload.regions).toEqual([{
        elementSelector: { boundingBox: { x: 0, y: 0, width: 10, height: 10 } },
        algorithm: 'ignore'
      }]);
      expect(payload.ignoredElementsData).toEqual({
        ignoreElementsData: [{ coOrdinates: { top: 20, left: 20, bottom: 30, right: 30 } }]
      });
      expect(payload.consideredElementsData).toEqual({
        considerElementsData: [{ coOrdinates: { top: 40, left: 40, bottom: 50, right: 50 } }]
      });
    });

    it('accepts a coordinate-only android request and forwards a transformed region', async () => {
      spyOn(percy, 'upload').and.resolveTo();
      await percy.start();

      await expectAsync(postMaestro({
        name: SS_NAME,
        sessionId: SID,
        platform: 'android',
        regions: [{ top: 0, bottom: 50, left: 0, right: 100, algorithm: 'ignore' }]
      })).toBeResolvedTo(jasmine.objectContaining({ success: true }));

      let [payload] = percy.upload.calls.mostRecent().args;
      expect(payload.regions).toEqual([{
        elementSelector: { boundingBox: { x: 0, y: 0, width: 100, height: 50 } },
        algorithm: 'ignore'
      }]);
    });

    it('iOS element region resolves via maestro-hierarchy; coord regions still forwarded', async () => {
      // The unified iOS path uses maestroDump → runIosHttpDump → maestro-CLI fallback.
      // In the test env (no PERCY_IOS_DEVICE_UDID/PERCY_IOS_DRIVER_HOST_PORT and no
      // maestro binary on PATH) the resolver returns env-missing, element regions
      // are skipped with a warning, and the snapshot uploads with only the coord
      // region forwarded.
      spyOn(percy, 'upload').and.resolveTo();
      await percy.start();

      let response = await postMaestro({
        name: SS_NAME,
        sessionId: SID,
        platform: 'ios',
        regions: [
          { element: { id: 'submitBtn' }, algorithm: 'ignore' },
          { top: 0, bottom: 20, left: 0, right: 20, algorithm: 'ignore' }
        ]
      });

      expect(response).toEqual(jasmine.objectContaining({ success: true }));
      let [payload] = percy.upload.calls.mostRecent().args;
      // Coord region forwarded; element region skipped (resolver unavailable in test env).
      expect(payload.regions).toEqual([{
        elementSelector: { boundingBox: { x: 0, y: 0, width: 20, height: 20 } },
        algorithm: 'ignore'
      }]);
      const log = logger.stderr.join('\n');
      expect(log).toMatch(/Element-region resolver unavailable/);
    });

    it('forwards testCase, labels, thTestCaseExecutionId, tile metadata, and sync mode', async () => {
      spyOn(percy.client, 'getComparisonDetails').and.returnValue(getSnapshotDetailsResponse);
      spyOn(percy, 'upload').and.callFake((_, callback) => callback.resolve());
      await percy.start();

      await expectAsync(postMaestro({
        name: SS_NAME,
        sessionId: SID,
        platform: 'android',
        tag: { name: 'Pixel 7', osName: 'Android', osVersion: '14', width: 1080, height: 2400, orientation: 'portrait' },
        testCase: 'smoke-tests',
        labels: 'nightly,smoke',
        thTestCaseExecutionId: 'TH-42',
        statusBarHeight: 50,
        navBarHeight: 48,
        fullscreen: true,
        sync: true
      })).toBeResolvedTo(jasmine.objectContaining({ data: getSnapshotDetailsResponse }));

      let [payload] = percy.upload.calls.mostRecent().args;
      expect(payload.testCase).toBe('smoke-tests');
      expect(payload.labels).toBe('nightly,smoke');
      expect(payload.thTestCaseExecutionId).toBe('TH-42');
      expect(payload.tiles[0]).toEqual(jasmine.objectContaining({ statusBarHeight: 50, navBarHeight: 48, fullscreen: true }));
      expect(payload.sync).toBe(true);
    });

    // Sync mode: a rejected upload is surfaced as data.error in a 200 response. The relay
    // wires the sync queue's reject to the snapshot promise, which handleSyncJob converts
    // into { error } rather than failing the request.
    it('sync mode: surfaces upload reject error as data.error (200 with error field)', async () => {
      spyOn(percy, 'upload').and.callFake((_, callback) => callback.reject(new Error('boom')));
      await percy.start();

      await expectAsync(postMaestro({
        name: SS_NAME,
        sessionId: SID,
        platform: 'android',
        sync: true
      })).toBeResolvedTo(jasmine.objectContaining({
        data: { error: 'boom' }
      }));
    });

    // Regression mirror of the /comparison and /automateScreenshot cases: percy.upload()
    // returns a Promise, so the relay must resolve through the sync callback rather than
    // `for await`-ing the return value ("upload is not async iterable").
    it('sync mode: resolves via the upload callback, not by iterating the return value', async () => {
      spyOn(percy.client, 'getComparisonDetails').and.returnValue(getSnapshotDetailsResponse);
      spyOn(percy, 'upload').and.callFake((options, callback) => {
        let promise = Promise.resolve();
        promise.then(() => callback.resolve());
        return promise;
      });
      await percy.start();

      await expectAsync(postMaestro({
        name: SS_NAME,
        sessionId: SID,
        platform: 'android',
        sync: true
      })).toBeResolvedTo(jasmine.objectContaining({ data: getSnapshotDetailsResponse }));

      expect(percy.upload).toHaveBeenCalledOnceWith(
        jasmine.objectContaining({ sync: true }), jasmine.objectContaining({}), 'app');
      // Proves handleSyncJob ran to completion rather than the request resolving early.
      expect(percy.client.getComparisonDetails).toHaveBeenCalled();
    });

    it('returns 404 when the screenshot file is missing', async () => {
      await percy.start();
      await expectAsync(postMaestro({ name: 'DoesNotExist', sessionId: SID, platform: 'android' }))
        .toBeRejectedWithError(/Screenshot not found/);
    });

    // filePath path — new SDK convention (R2/R3/R4/R6).
    // The SDK posts an absolute path the relay reads directly, skipping the legacy glob.
    // Same realpath + per-platform session-root prefix check protects against traversal
    // and symlink-escape; the cross-sessionId and outside-root tests below exercise it.

    it('accepts filePath pointing to a file under the Android session root', async () => {
      spyOn(percy, 'upload').and.resolveTo();
      await percy.start();

      await expectAsync(postMaestro({
        name: FILEPATH_NAME,
        sessionId: SID,
        platform: 'android',
        filePath: `${ANDROID_FILEPATH_DIR}/${FILEPATH_NAME}.png`
      })).toBeResolvedTo(jasmine.objectContaining({ success: true }));

      let [payload] = percy.upload.calls.mostRecent().args;
      expect(payload.tiles[0].content).toBe(Buffer.from('PNGBYTES-FILEPATH-ANDROID').toString('base64'));
    });

    it('accepts filePath pointing to a file under the iOS session root', async () => {
      spyOn(percy, 'upload').and.resolveTo();
      await percy.start();

      await expectAsync(postMaestro({
        name: FILEPATH_NAME,
        sessionId: SID,
        platform: 'ios',
        filePath: `${IOS_FILEPATH_DIR}/${FILEPATH_NAME}.png`
      })).toBeResolvedTo(jasmine.objectContaining({ success: true }));

      let [payload] = percy.upload.calls.mostRecent().args;
      expect(payload.tiles[0].content).toBe(Buffer.from('PNGBYTES-FILEPATH-IOS').toString('base64'));
    });

    it('rejects filePath that is not a string with 400', async () => {
      await percy.start();
      await expectAsync(postMaestro({
        name: SS_NAME,
        sessionId: SID,
        platform: 'android',
        filePath: 12345
      })).toBeRejectedWithError(/filePath.*must be a string/i);
    });

    it('rejects filePath that is not an absolute path with 400', async () => {
      await percy.start();
      await expectAsync(postMaestro({
        name: SS_NAME,
        sessionId: SID,
        platform: 'android',
        filePath: 'relative/path/screenshot.png'
      })).toBeRejectedWithError(/filePath.*absolute/i);
    });

    it('rejects filePath exceeding the maximum length with 400', async () => {
      await percy.start();
      await expectAsync(postMaestro({
        name: SS_NAME,
        sessionId: SID,
        platform: 'android',
        filePath: '/' + 'a'.repeat(1100)
      })).toBeRejectedWithError(/filePath.*maximum length/i);
    });

    it('returns 404 when filePath points to a missing file', async () => {
      await percy.start();
      await expectAsync(postMaestro({
        name: SS_NAME,
        sessionId: SID,
        platform: 'android',
        filePath: `${ANDROID_FILEPATH_DIR}/DoesNotExist.png`
      })).toBeRejectedWithError(/Screenshot not found/);
    });

    it('returns 404 when filePath resolves outside the session root', async () => {
      // File exists, but lives at /tmp/<other>.png — not under /tmp/<sid>_test_suite/.
      fs.writeFileSync('/tmp/percy-outside.png', 'OUTSIDE');
      await percy.start();
      await expectAsync(postMaestro({
        name: SS_NAME,
        sessionId: SID,
        platform: 'android',
        filePath: '/tmp/percy-outside.png'
      })).toBeRejectedWithError(/Screenshot not found/);
    });

    it('returns 404 when filePath is in a different sessionId\'s subtree', async () => {
      const otherDir = '/tmp/othersession_test_suite/percy';
      fs.mkdirSync(otherDir, { recursive: true });
      fs.writeFileSync(`${otherDir}/Foo.png`, 'OTHER-SID');
      await percy.start();
      await expectAsync(postMaestro({
        name: 'Foo',
        sessionId: SID,
        platform: 'android',
        filePath: `${otherDir}/Foo.png`
      })).toBeRejectedWithError(/Screenshot not found/);
    });

    it('treats empty filePath as absent and falls back to the legacy glob', async () => {
      spyOn(percy, 'upload').and.resolveTo();
      await percy.start();

      await expectAsync(postMaestro({
        name: SS_NAME,
        sessionId: SID,
        platform: 'android',
        filePath: ''
      })).toBeResolvedTo(jasmine.objectContaining({ success: true }));

      let [payload] = percy.upload.calls.mostRecent().args;
      // Glob found the legacy fixture, not the filePath fixture
      expect(payload.tiles[0].content).toBe(Buffer.from('PNGBYTES-ANDROID').toString('base64'));
    });

    // PNG-header fill: relay reads IHDR from the screenshot and populates
    // payload.tag.width / payload.tag.height when missing. Source of truth
    // for tag dims is the PNG bytes themselves — what Percy stores and
    // compares against. See docs/plans/2026-05-23-001-refactor-maestro-screen-dims-via-png-header-plan.md.

    // Helper: build a minimal-but-valid PNG header (signature + IHDR chunk)
    // with the given pixel dimensions. The relay only inspects the first 24
    // bytes for IHDR, so we don't need a full PNG — 24 bytes suffice.
    function makePngHeader(width, height) {
      const buf = Buffer.alloc(24);
      Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]).copy(buf, 0);
      buf.writeUInt32BE(13, 8);
      Buffer.from('IHDR', 'ascii').copy(buf, 12);
      buf.writeUInt32BE(width, 16);
      buf.writeUInt32BE(height, 20);
      return buf;
    }

    it('PNG-fill: populates tag.width/height from PNG IHDR when customer did not supply them', async () => {
      // Replace the Android fixture with a real PNG header at known dims.
      fs.writeFileSync(path.join(ANDROID_DIR, `${SS_NAME}.png`), makePngHeader(1008, 2244));
      spyOn(percy, 'upload').and.resolveTo();
      await percy.start();

      await expectAsync(postMaestro({
        name: SS_NAME, sessionId: SID, platform: 'android'
      })).toBeResolvedTo(jasmine.objectContaining({ success: true }));

      let [payload] = percy.upload.calls.mostRecent().args;
      expect(payload.tag.width).toBe(1008);
      expect(payload.tag.height).toBe(2244);
    });

    it('PNG-fill: customer-supplied tag.width/height continue to win (fill, not override)', async () => {
      fs.writeFileSync(path.join(ANDROID_DIR, `${SS_NAME}.png`), makePngHeader(1008, 2244));
      spyOn(percy, 'upload').and.resolveTo();
      await percy.start();

      // Customer pins their own tag dims; relay must NOT override.
      await expectAsync(postMaestro({
        name: SS_NAME,
        sessionId: SID,
        platform: 'android',
        tag: { name: 'Pinned', width: 1080, height: 2400 }
      })).toBeResolvedTo(jasmine.objectContaining({ success: true }));

      let [payload] = percy.upload.calls.mostRecent().args;
      expect(payload.tag.width).toBe(1080);
      expect(payload.tag.height).toBe(2400);
    });

    it('PNG-fill: partial customer tag — fills only the missing field', async () => {
      fs.writeFileSync(path.join(ANDROID_DIR, `${SS_NAME}.png`), makePngHeader(1008, 2244));
      spyOn(percy, 'upload').and.resolveTo();
      await percy.start();

      // Customer pins width only; relay fills height from PNG.
      await expectAsync(postMaestro({
        name: SS_NAME,
        sessionId: SID,
        platform: 'android',
        tag: { name: 'Partial', width: 1080 }
      })).toBeResolvedTo(jasmine.objectContaining({ success: true }));

      let [payload] = percy.upload.calls.mostRecent().args;
      expect(payload.tag.width).toBe(1080); // customer wins
      expect(payload.tag.height).toBe(2244); // PNG fills
    });

    it('PNG-fill: non-PNG signature → skip silently, tag dims unchanged', async () => {
      // Default Android fixture is the string 'PNGBYTES-ANDROID' which fails
      // the PNG signature check (first byte is 0x50 'P' not 0x89). Relay
      // should NOT populate tag.width/height.
      spyOn(percy, 'upload').and.resolveTo();
      await percy.start();

      await expectAsync(postMaestro({
        name: SS_NAME, sessionId: SID, platform: 'android'
      })).toBeResolvedTo(jasmine.objectContaining({ success: true }));

      let [payload] = percy.upload.calls.mostRecent().args;
      expect(payload.tag.width).toBeUndefined();
      expect(payload.tag.height).toBeUndefined();
    });

    it('PNG-fill: truncated file (<24 bytes) but valid signature start → skip silently', async () => {
      // 20-byte buffer with the PNG signature but no complete IHDR.
      const truncated = Buffer.alloc(20);
      Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]).copy(truncated, 0);
      fs.writeFileSync(path.join(ANDROID_DIR, `${SS_NAME}.png`), truncated);
      spyOn(percy, 'upload').and.resolveTo();
      await percy.start();

      await expectAsync(postMaestro({
        name: SS_NAME, sessionId: SID, platform: 'android'
      })).toBeResolvedTo(jasmine.objectContaining({ success: true }));

      let [payload] = percy.upload.calls.mostRecent().args;
      expect(payload.tag.width).toBeUndefined();
      expect(payload.tag.height).toBeUndefined();
    });

    it('PNG-fill: PNG with width=0 → defensive skip (no orphan tag dim)', async () => {
      fs.writeFileSync(path.join(ANDROID_DIR, `${SS_NAME}.png`), makePngHeader(0, 2244));
      spyOn(percy, 'upload').and.resolveTo();
      await percy.start();

      await expectAsync(postMaestro({
        name: SS_NAME, sessionId: SID, platform: 'android'
      })).toBeResolvedTo(jasmine.objectContaining({ success: true }));

      let [payload] = percy.upload.calls.mostRecent().args;
      expect(payload.tag.width).toBeUndefined();
      expect(payload.tag.height).toBeUndefined();
    });

    it('PNG-fill: filePath path also gets PNG dims populated', async () => {
      // Write a valid PNG at the filePath fixture location.
      fs.writeFileSync(path.join(ANDROID_FILEPATH_DIR, `${FILEPATH_NAME}.png`), makePngHeader(1179, 2556));
      spyOn(percy, 'upload').and.resolveTo();
      await percy.start();

      await expectAsync(postMaestro({
        name: FILEPATH_NAME,
        sessionId: SID,
        platform: 'android',
        filePath: `${ANDROID_FILEPATH_DIR}/${FILEPATH_NAME}.png`
      })).toBeResolvedTo(jasmine.objectContaining({ success: true }));

      let [payload] = percy.upload.calls.mostRecent().args;
      expect(payload.tag.width).toBe(1179);
      expect(payload.tag.height).toBe(2556);
    });

    // ─────────────────────────────────────────────────────────────────────
    // Self-hosted mode: `sessionId` absent triggers PERCY_MAESTRO_SCREENSHOT_DIR
    // resolution. The BS path (sessionId present) is byte-identical and
    // covered above; these tests lock the new branches.
    // ─────────────────────────────────────────────────────────────────────
    describe('self-hosted (sessionId absent)', () => {
      // Real-fs root (matched by the $bypass registered in the top-level
      // beforeEach) so the recursive `**` + `dot:true` glob runs against the
      // real filesystem — the production path — rather than memfs.
      // Use os.tmpdir() (not hardcoded `/tmp/`) so the fixtures work on
      // Windows runners too — Windows has no `/tmp/`; the CI fails 404 on
      // every glob when the root never gets created.
      const SELF_HOSTED_ROOT = path.join(os.tmpdir(), 'percy-self-hosted-real-root');
      const NESTED_SUBDIR = path.join(SELF_HOSTED_ROOT, '.maestro', 'run-x', 'screenshots');
      const SELF_HOSTED_NAME = 'SelfHostedScreen';
      let priorEnv;

      beforeEach(() => {
        priorEnv = process.env.PERCY_MAESTRO_SCREENSHOT_DIR;
        process.env.PERCY_MAESTRO_SCREENSHOT_DIR = SELF_HOSTED_ROOT;
        fs.rmSync(SELF_HOSTED_ROOT, { recursive: true, force: true });
        fs.mkdirSync(NESTED_SUBDIR, { recursive: true });
        // Valid 24-byte PNG header (1080 x 2400) exercises PNG-fill on the
        // self-hosted path too.
        const pngHeader = Buffer.alloc(24);
        Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]).copy(pngHeader, 0);
        pngHeader.writeUInt32BE(13, 8);
        Buffer.from('IHDR', 'ascii').copy(pngHeader, 12);
        pngHeader.writeUInt32BE(1080, 16);
        pngHeader.writeUInt32BE(2400, 20);
        fs.writeFileSync(path.join(NESTED_SUBDIR, `${SELF_HOSTED_NAME}.png`), pngHeader);
      });

      afterEach(() => {
        if (priorEnv === undefined) delete process.env.PERCY_MAESTRO_SCREENSHOT_DIR;
        else process.env.PERCY_MAESTRO_SCREENSHOT_DIR = priorEnv;
        // Clean up the real-fs fixture root (see beforeEach / top-level $bypass).
        fs.rmSync(SELF_HOSTED_ROOT, { recursive: true, force: true });
      });

      it('finds screenshot via recursive glob under PERCY_MAESTRO_SCREENSHOT_DIR and uploads without sessionId', async () => {
        await percy.start();
        spyOn(percy, 'upload').and.resolveTo();
        let res = await postMaestro({ name: SELF_HOSTED_NAME, platform: 'android' });
        expect(res.success).toBe(true);
        let [payload] = percy.upload.calls.mostRecent().args;
        expect(payload.name).toBe(SELF_HOSTED_NAME);
        expect(payload.tag.width).toBe(1080);
        expect(payload.tag.height).toBe(2400);
        expect(payload.tiles[0].content).toBeDefined();
        // sessionId is never forwarded into the upload payload (relay only
        // used it for scoping; self-hosted has no equivalent).
        expect(payload.sessionId).toBeUndefined();
      });

      it('400s when PERCY_MAESTRO_SCREENSHOT_DIR is not absolute', async () => {
        process.env.PERCY_MAESTRO_SCREENSHOT_DIR = 'relative/path';
        await percy.start();
        await expectAsync(postMaestro({ name: SELF_HOSTED_NAME }))
          .toBeRejectedWithError(/PERCY_MAESTRO_SCREENSHOT_DIR must be an absolute path/);
      });

      it('400s when PERCY_MAESTRO_SCREENSHOT_DIR does not exist', async () => {
        process.env.PERCY_MAESTRO_SCREENSHOT_DIR = path.join(os.tmpdir(), 'this-path-does-not-exist-percy-self-hosted');
        await percy.start();
        await expectAsync(postMaestro({ name: SELF_HOSTED_NAME }))
          .toBeRejectedWithError(/PERCY_MAESTRO_SCREENSHOT_DIR is not an existing directory/);
      });

      it('400s when PERCY_MAESTRO_SCREENSHOT_DIR points to a file, not a directory', async () => {
        const notADir = path.join(os.tmpdir(), 'percy-self-hosted-not-a-dir');
        fs.writeFileSync(notADir, 'plain-file');
        process.env.PERCY_MAESTRO_SCREENSHOT_DIR = notADir;
        await percy.start();
        await expectAsync(postMaestro({ name: SELF_HOSTED_NAME }))
          .toBeRejectedWithError(/PERCY_MAESTRO_SCREENSHOT_DIR is not an existing directory/);
      });

      it('rejects a supplied filePath in self-hosted mode (security invariant)', async () => {
        // The SDK never emits filePath self-hosted; honoring it against a
        // caller-influenceable root would re-open arbitrary in-root reads.
        await percy.start();
        await expectAsync(postMaestro({
          name: SELF_HOSTED_NAME,
          filePath: `${NESTED_SUBDIR}/${SELF_HOSTED_NAME}.png`
        })).toBeRejectedWithError(/filePath is not accepted in self-hosted mode/);
      });

      it('404s when the screenshot is missing under the configured root', async () => {
        await percy.start();
        await expectAsync(postMaestro({ name: 'NoSuchScreenshot' }))
          .toBeRejectedWithError(/Screenshot not found/);
      });

      it('404s when a globbed file resolves outside the root (symlink escape)', async () => {
        // A symlink inside the root that points outside it must not exfiltrate
        // the target — the realpath + prefix check rejects it (self-hosted arm
        // of the "resolved outside" guard). Uses real fs via the $bypass.
        const outside = path.join(os.tmpdir(), 'percy-self-hosted-real-OUTSIDE.png');
        fs.writeFileSync(outside, 'OUTSIDE');
        fs.symlinkSync(outside, path.join(NESTED_SUBDIR, 'EscapeScreen.png'));
        await percy.start();
        await expectAsync(postMaestro({ name: 'EscapeScreen', platform: 'android' }))
          .toBeRejectedWithError(/resolved outside PERCY_MAESTRO_SCREENSHOT_DIR/);
        fs.rmSync(outside, { force: true });
      });

      it('rejects name with traversal characters (SAFE_ID is load-bearing for the recursive glob)', async () => {
        await percy.start();
        await expectAsync(postMaestro({ name: '../etc/passwd' }))
          .toBeRejectedWithError(/Invalid screenshot name/);
      });

      it('coordinate regions still pass through on the self-hosted path', async () => {
        await percy.start();
        spyOn(percy, 'upload').and.resolveTo();
        await postMaestro({
          name: SELF_HOSTED_NAME,
          platform: 'android',
          regions: [{ top: 10, bottom: 50, left: 0, right: 100, algorithm: 'ignore' }]
        });
        let [payload] = percy.upload.calls.mostRecent().args;
        expect(payload.regions).toBeDefined();
        expect(payload.regions.length).toBe(1);
        expect(payload.regions[0].elementSelector.boundingBox)
          .toEqual({ x: 0, y: 10, width: 100, height: 40 });
        expect(payload.regions[0].algorithm).toBe('ignore');
      });

      // Multi-match mtime selection — Maestro re-runs in the same root leave
      // older fixtures behind under different timestamped sub-dirs. The relay
      // picks the most-recently-modified match. This locks that determinism
      // for the self-hosted code path (the BS arm has been exercising this
      // branch via integration tests).
      it('selects the most-recently-modified PNG when multiple matches exist under the root', async () => {
        // Two PNG fixtures at different depths with distinct dimensions and
        // mtimes. The newer one (larger size) must win.
        const OLD_DIR = path.join(SELF_HOSTED_ROOT, '.maestro', 'run-old', 'screenshots');
        const NEW_DIR = path.join(SELF_HOSTED_ROOT, '.maestro', 'run-new', 'screenshots');
        fs.mkdirSync(OLD_DIR, { recursive: true });
        fs.mkdirSync(NEW_DIR, { recursive: true });

        // Helper: a valid 24-byte PNG header with the supplied dimensions.
        const pngOf = (w, h) => {
          const buf = Buffer.alloc(24);
          Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]).copy(buf, 0);
          buf.writeUInt32BE(13, 8);
          Buffer.from('IHDR', 'ascii').copy(buf, 12);
          buf.writeUInt32BE(w, 16);
          buf.writeUInt32BE(h, 20);
          return buf;
        };

        // Same `name` under both — recursive glob will find both.
        const NAME = 'MultiMatch';
        const oldFile = path.join(OLD_DIR, `${NAME}.png`);
        const newFile = path.join(NEW_DIR, `${NAME}.png`);
        fs.writeFileSync(oldFile, pngOf(720, 1280));
        fs.writeFileSync(newFile, pngOf(1080, 2400));

        // Stamp explicit mtimes so the assertion doesn't depend on fs write
        // order. The 60-second gap is chosen to survive CI filesystems with
        // 1-second mtime resolution (ext4 without `relatime`, common older
        // CI images) — at that floor the two writes could otherwise round
        // to the same mtime and the ordering assertion would be racy.
        // `fs.utimesSync` takes atime/mtime in SECONDS (POSIX `time_t`).
        const now = Date.now() / 1000;
        fs.utimesSync(oldFile, now - 60, now - 60);
        fs.utimesSync(newFile, now, now);

        await percy.start();
        spyOn(percy, 'upload').and.resolveTo();
        let res = await postMaestro({ name: NAME, platform: 'android' });
        expect(res.success).toBe(true);
        let [payload] = percy.upload.calls.mostRecent().args;
        // Newer fixture's dimensions reach the payload.
        expect(payload.tag.width).toBe(1080);
        expect(payload.tag.height).toBe(2400);
      });
    });

    describe('device system-bar inset derivation (relay wiring)', () => {
      it('CLI-derived insets are authoritative over the SDK-sent defaults (Android)', async () => {
        // Override the beforeEach null seed with a derived result.
        percy.maestroInsetCache.set(SID, { statusBarHeight: 141, navBarHeight: 168 });
        spyOn(percy, 'upload').and.resolveTo();
        await percy.start();

        await expectAsync(postMaestro({
          name: SS_NAME,
          sessionId: SID,
          platform: 'android',
          statusBarHeight: 50,
          navBarHeight: 48
        })).toBeResolvedTo(jasmine.objectContaining({ success: true }));

        let [payload] = percy.upload.calls.mostRecent().args;
        expect(payload.tiles[0]).toEqual(jasmine.objectContaining({ statusBarHeight: 141, navBarHeight: 168 }));
      });

      it('falls back to the SDK-sent values when derivation yields null (Android)', async () => {
        percy.maestroInsetCache.set(SID, null);
        spyOn(percy, 'upload').and.resolveTo();
        await percy.start();

        await expectAsync(postMaestro({
          name: SS_NAME,
          sessionId: SID,
          platform: 'android',
          statusBarHeight: 50,
          navBarHeight: 48
        })).toBeResolvedTo(jasmine.objectContaining({ success: true }));

        let [payload] = percy.upload.calls.mostRecent().args;
        expect(payload.tiles[0]).toEqual(jasmine.objectContaining({ statusBarHeight: 50, navBarHeight: 48 }));
      });

      it('iOS navBarHeight is always 0, even when the SDK sends a value', async () => {
        percy.maestroInsetCache.set(SID, { statusBarHeight: 141, navBarHeight: 0 });
        spyOn(percy, 'upload').and.resolveTo();
        await percy.start();

        await expectAsync(postMaestro({
          name: SS_NAME,
          sessionId: SID,
          platform: 'ios',
          statusBarHeight: 47,
          navBarHeight: 80
        })).toBeResolvedTo(jasmine.objectContaining({ success: true }));

        let [payload] = percy.upload.calls.mostRecent().args;
        expect(payload.tiles[0].statusBarHeight).toBe(141);
        expect(payload.tiles[0].navBarHeight).toBe(0);
      });

      it('derives once and caches the outcome (incl. null) per session', async () => {
        // Cache miss → derive. iOS with no PERCY_IOS_DRIVER_HOST_PORT env yields
        // null deterministically (no transport spawn). Outcome is cached.
        percy.maestroInsetCache.delete(SID);
        spyOn(percy, 'upload').and.resolveTo();
        await percy.start();

        await expectAsync(postMaestro({
          name: SS_NAME,
          sessionId: SID,
          platform: 'ios',
          statusBarHeight: 47
        })).toBeResolvedTo(jasmine.objectContaining({ success: true }));

        // Null outcome cached, and the tile fell back to the SDK-sent value.
        expect(percy.maestroInsetCache.has(SID)).toBe(true);
        expect(percy.maestroInsetCache.get(SID)).toBeNull();
        let [payload] = percy.upload.calls.mostRecent().args;
        expect(payload.tiles[0].statusBarHeight).toBe(47);
      });
    });
  });
});

// Pure unit tests for the stripping helper — kept in their own describe so they don't
// drag the API Server's beforeEach (Percy instance + Chromium setup). Through the
// production caller every intermediate of a returned path is verified present, so the
// `o?.[k]` defensive guard inside _applyHttpReadOnlyStripping is unreachable in normal
// use. These tests pin that guard directly so a refactor can't silently lose it.
describe('_applyHttpReadOnlyStripping', () => {
  it('tolerates paths whose ancestor is absent from body', () => {
    let log = { warn: jasmine.createSpy('warn') };
    let body = { unrelated: { keep: true } };
    let result = _applyHttpReadOnlyStripping(
      body,
      ['discovery.launchOptions.executable'],
      log
    );

    // Body is deep-cloned (not mutated); the missing path is a no-op delete.
    expect(result).toEqual({ unrelated: { keep: true } });
    expect(result).not.toBe(body);
    // The warning still fires — caller is told the field was rejected.
    expect(log.warn).toHaveBeenCalledWith(
      jasmine.stringMatching(/Ignoring `discovery\.launchOptions\.executable`/)
    );
  });

  it('returns body unchanged (no clone) when paths is empty', () => {
    let log = { warn: jasmine.createSpy('warn') };
    let body = { discovery: { launchOptions: { headless: true } } };
    let result = _applyHttpReadOnlyStripping(body, [], log);

    expect(result).toBe(body);
    expect(log.warn).not.toHaveBeenCalled();
  });
});
