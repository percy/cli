import path from 'path';
import PercyConfig from '@percy/config';
import { logger, setupTest, fs } from './helpers/index.js';
import Percy from '@percy/core';
import WebdriverUtils from '@percy/webdriver-utils';
import { getPercyDomPath } from '../src/api.js';

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
    await setupTest();

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
      }
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
      logger.instance.messages.clear();
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
      let { widths, config } = await get('/percy/healthcheck');
      expect(widths.config).toEqual([375, 1280]);
      expect(widths.mobile).toEqual([]);

      await post('/test/api/config', { config: [390], deferUploads: true });
      ({ widths, config } = await get('/percy/healthcheck'));
      expect(widths.config).toEqual([390]);
      expect(config.snapshot.responsiveSnapshotCapture).toEqual(false);
      expect(config.percy.deferUploads).toEqual(true);

      await post('/test/api/config', { config: [375, 1280], mobile: [456], responsive: true });
      ({ widths, config } = await get('/percy/healthcheck'));
      expect(widths.mobile).toEqual([456]);
      expect(config.snapshot.responsiveSnapshotCapture).toEqual(true);
      expect(config.percy.deferUploads).toEqual(false);
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
});
