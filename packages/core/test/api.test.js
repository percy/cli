import path from 'path';
import PercyConfig from '@percy/config';
import { logger, setupTest, fs } from './helpers/index.js';
import Percy from '@percy/core';

describe('API Server', () => {
  let percy;

  async function request(path, ...args) {
    let { request } = await import('./helpers/request.js');
    return request(new URL(path, percy.address()), ...args);
  }

  beforeEach(async () => {
    await setupTest();

    percy = new Percy({
      token: 'PERCY_TOKEN',
      port: 1337
    });
  });

  afterEach(async () => {
    percy.stop.and?.callThrough();
    await percy.stop();
  });

  it('has a default port', () => {
    expect(new Percy()).toHaveProperty('server.port', 5338);
  });

  it('can specify a custom port', () => {
    expect(percy).toHaveProperty('server.port', 1337);
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
      build: {
        id: '123',
        number: 1,
        url: 'https://percy.io/test/test/123'
      }
    });
  });

  it('has a /config endpoint that returns loaded config options', async () => {
    await percy.start();

    await expectAsync(request('/percy/config')).toBeResolvedTo({
      success: true,
      config: PercyConfig.getDefaults()
    });
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

    expect(logger.stderr).toEqual(['[percy] Warning: ' + [
      'It looks like you’re using @percy/cli with an older SDK.',
      'Please upgrade to the latest version to fix this warning.',
      'See these docs for more info: https:docs.percy.io/docs/migrating-to-percy-cli'
    ].join(' ')]);
  });

  it('has a /stop endpoint that calls #stop()', async () => {
    spyOn(percy, 'stop').and.resolveTo();
    await percy.start();

    await expectAsync(request('/percy/stop', 'POST')).toBeResolvedTo({ success: true });
    expect(percy.stop).toHaveBeenCalled();
  });

  it('has a /snapshot endpoint that calls #snapshot() with provided options', async () => {
    spyOn(percy, 'snapshot').and.resolveTo();
    await percy.start();

    await expectAsync(request('/percy/snapshot', {
      method: 'POST',
      body: { 'test-me': true, me_too: true }
    })).toBeResolvedTo({
      success: true
    });

    expect(percy.snapshot).toHaveBeenCalledOnceWith(
      { 'test-me': true, me_too: true }
    );
  });

  it('can handle snapshots async with a parameter', async () => {
    let test = new Promise(r => setTimeout(r, 500));
    spyOn(percy, 'snapshot').and.returnValue(test);
    await percy.start();

    await expectAsync(
      request('/percy/snapshot?async', 'POST')
    ).toBeResolvedTo({
      success: true
    });

    await expectAsync(test).toBePending();
    await test; // no hanging promises
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
      percy = await Percy.start({ testing: true });
      logger.instance.messages.clear();
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
