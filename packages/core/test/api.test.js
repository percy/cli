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
      let args = ['--no-warnings', '--input-type=module', '--loader=../../scripts/loader.js'];

      exec(`node ${args.join(' ')} --eval "${[
        "import WebSocket from 'ws';",
        "import logger from '@percy/logger';",
        "let ws = new WebSocket('ws://localhost:1337');",
        "logger.loglevel('debug');",
        'await logger.remote(() => ws);',
        "logger('remote-sdk').info('whoa');",
        'setTimeout(() => ws.close(), 100);'
      ].join('')}"`, (err, stdout, stderr) => {
        if (!err) resolve([stdout, stderr]);
        else reject(err);
      });
    });

    // child logs are present on connection failure
    expect(stdout.toString()).toEqual('');
    expect(stderr.toString()).toEqual('');

    expect(logger.stderr).toEqual([]);
    expect(logger.stdout).toEqual([
      '[percy:remote-sdk] whoa'
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
});
