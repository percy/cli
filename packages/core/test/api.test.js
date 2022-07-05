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

  it('facilitates logger websocket connections', async () => {
    let { exec } = await import('child_process');
    await percy.start();

    logger.reset();
    logger.loglevel('debug');

    // log from a separate async process
    let [stdout, stderr] = await new Promise((resolve, reject) => {
      exec(`node --eval "(async () => {${[
        "const WebSocket = require('ws');",
        // assert that loggers can connect at the root endpoint
        "const ws1 = new WebSocket('ws://localhost:1337');",
        "const ws2 = new WebSocket('ws://localhost:1337/logger');",
        // assert that websockets recieve a message with the loglevel when connected
        'let m = await Promise.all([ws1, ws2].map(w => new Promise(r => w.onmessage = r)));',
        "if (!m.every(e => JSON.parse(e.data).loglevel === 'debug')) throw new Error('No loglevel');",
        // assert that remote loggers can provide message history and print remote logs
        "ws1.send(JSON.stringify({ messages: [{ debug: 'remote', message: 'test history' }] }));",
        "ws2.send(JSON.stringify({ log: ['remote', 'info', 'test info'] }));",
        // close the websockets after sending the above messages
        'setTimeout(() => [ws1, ws2].map(w => w.close()), 100);'
      ].join('')}})()"`, (err, stdout, stderr) => {
        if (!err) resolve([stdout, stderr]);
        else reject(err);
      });
    });

    // logs are present on connection failure
    expect(stdout.toString()).toEqual('');
    expect(stderr.toString()).toEqual('');

    expect(logger.instance.messages).toContain(
      jasmine.objectContaining({ debug: 'remote', message: 'test history' })
    );

    expect(logger.stderr).toEqual([]);
    expect(logger.stdout).toEqual([
      '[percy:remote] test info'
    ]);
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
      percy = await Percy.start({
        testing: true
      });
    });

    it('implies loglevel silent and dryRun', () => {
      expect(percy.testing).toBeDefined();
      expect(percy.loglevel()).toEqual('silent');
      expect(percy.dryRun).toBeTrue();
    });

    it('enables several /test/api endpoint commands', async () => {
      expect(percy.testing).toEqual({});
      await post('/test/api/version', false);
      expect(percy.testing).toHaveProperty('version', false);
      await post('/test/api/version', '0.0.1');
      expect(percy.testing).toHaveProperty('version', '0.0.1');
      await post('/test/api/reset');
      expect(percy.testing).toEqual({});
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

    it('can make endpoints destroy connections via /test/api/disconnect', async () => {
      await expectAsync(req('/percy/healthcheck')).toBeResolved();
      await post('/test/api/disconnect', '/percy/healthcheck');
      await expectAsync(req('/percy/healthcheck')).toBeRejected();
    });

    it('enables a /test/logs endpoint to return raw logs', async () => {
      percy.log.info('foo bar from test');
      let { logs } = await get('/test/logs');

      expect(logs).toEqual(jasmine.arrayContaining([
        jasmine.objectContaining({ message: 'foo bar from test' })
      ]));
    });

    it('enables a /test/snapshot endpoint that serves a simple html document', async () => {
      await expectAsync(get('/test/snapshot')).toBeResolvedTo('<p>Snapshot Me!</p>');
    });
  });
});
