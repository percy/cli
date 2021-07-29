import fetch from 'node-fetch';
import PercyConfig from '@percy/config';
import Percy from '../src';
import pkg from '../package.json';
import { logger } from './helpers';

describe('Server', () => {
  let percy;

  beforeEach(() => {
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
    expect(new Percy()).toHaveProperty('port', 5338);
  });

  it('can specify a custom port', () => {
    expect(percy).toHaveProperty('port', 1337);
  });

  it('starts a server at the specified port', async () => {
    await expectAsync(percy.start()).toBeResolved();
    await expectAsync(fetch('http://localhost:1337')).toBeResolved();
  });

  it('has a /healthcheck endpoint', async () => {
    await percy.start();

    let response = await fetch('http://localhost:1337/percy/healthcheck');
    expect(response.headers.get('x-percy-core-version')).toMatch(pkg.version);
    await expectAsync(response.json()).toBeResolvedTo({
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

  it('has an /idle endpoint that calls #idle()', async () => {
    spyOn(percy, 'idle').and.resolveTo();
    await percy.start();

    let response = await fetch('http://localhost:1337/percy/idle');
    expect(response.headers.get('x-percy-core-version')).toMatch(pkg.version);
    await expectAsync(response.json()).toBeResolvedTo({ success: true });
    expect(percy.idle).toHaveBeenCalled();
  });

  it('serves the @percy/dom bundle', async () => {
    let bundle = require('fs')
      .readFileSync(require.resolve('@percy/dom'), { encoding: 'utf-8' });

    await percy.start();
    let response = await fetch('http://localhost:1337/percy/dom.js');
    await expectAsync(response.text()).toBeResolvedTo(bundle);
  });

  it('serves the legacy percy-agent.js dom bundle', async () => {
    let bundle = require('fs')
      .readFileSync(require.resolve('@percy/dom'), { encoding: 'utf-8' })
      .concat('(window.PercyAgent = class PercyAgent { snapshot(n, o) { return PercyDOM.serialize(o); } });');

    await percy.start();
    let response = await fetch('http://localhost:1337/percy-agent.js');

    await expectAsync(response.text()).toBeResolvedTo(bundle);
    expect(logger.stderr).toEqual([
      '[percy] Warning: It looks like you’re using @percy/cli with an older SDK. Please upgrade to the latest version' +
        ' to fix this warning. See these docs for more info: https://docs.percy.io/docs/migrating-to-percy-cli'
    ]);
  });

  it('has a /stop endpoint that calls #stop()', async () => {
    spyOn(percy, 'stop').and.resolveTo();
    await percy.start();

    let response = await fetch('http://localhost:1337/percy/stop', { method: 'post' });
    expect(response.headers.get('x-percy-core-version')).toMatch(pkg.version);
    await expectAsync(response.json()).toBeResolvedTo({ success: true });
    expect(percy.stop).toHaveBeenCalled();
  });

  it('has a /snapshot endpoint that calls #snapshot() with provided options', async () => {
    spyOn(percy, 'snapshot').and.resolveTo();
    await percy.start();

    let response = await fetch('http://localhost:1337/percy/snapshot', {
      method: 'post',
      body: '{ "test-me": true, "me_too": true }'
    });

    expect(response.headers.get('x-percy-core-version')).toMatch(pkg.version);
    await expectAsync(response.json()).toBeResolvedTo({ success: true });
    expect(percy.snapshot).toHaveBeenCalledOnceWith({ 'test-me': true, me_too: true });
  });

  it('returns a 500 error when an endpoint throws', async () => {
    spyOn(percy, 'snapshot').and.rejectWith(new Error('test error'));
    await percy.start();

    let response = await fetch('http://localhost:1337/percy/snapshot', {
      method: 'post',
      body: '{ "test": true }'
    });

    expect(response.headers.get('x-percy-core-version')).toMatch(pkg.version);
    await expectAsync(response.json()).toBeResolvedTo({
      success: false,
      error: 'test error'
    });
  });

  it('returns a 404 for any other endpoint', async () => {
    await percy.start();

    let response = await fetch('http://localhost:1337/foobar');
    expect(response).toHaveProperty('status', 404);

    expect(response.headers.get('x-percy-core-version')).toMatch(pkg.version);
    await expectAsync(response.json()).toBeResolvedTo({
      success: false,
      error: 'Not found'
    });
  });

  it('accepts preflight cors checks', async () => {
    let response;

    spyOn(percy, 'snapshot').and.resolveTo();
    await percy.start();

    response = await fetch('http://localhost:1337/percy/snapshot', {
      method: 'OPTIONS'
    });

    expect(response.status).toBe(204);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(response.headers.get('Access-Control-Allow-Methods')).toBe('GET,POST,OPTIONS');
    expect(response.headers.get('Access-Control-Request-Headers')).toBe('Vary');
    expect(response.headers.get('Access-Control-Expose-Headers')).toBe('X-Percy-Core-Version');
    expect(percy.snapshot).not.toHaveBeenCalled();

    response = await fetch('http://localhost:1337/percy/snapshot', {
      headers: { 'Access-Control-Request-Headers': 'Content-Type' },
      method: 'OPTIONS'
    });

    expect(response.status).toBe(204);
    expect(response.headers.get('Access-Control-Allow-Headers')).toBe('Content-Type');
    expect(percy.snapshot).not.toHaveBeenCalled();
  });

  it('facilitates logger websocket connections', async () => {
    await percy.start();

    logger.reset();
    logger.loglevel('debug');

    // log from a separate async process
    let [stdout, stderr] = await new Promise((resolve, reject) => {
      require('child_process').exec('node -e "' + [
        "let logger = require('@percy/logger');",
        "let ws = new (require('ws'))('ws://localhost:1337');",
        "logger.loglevel('debug');",
        'logger.remote(() => ws)',
        "  .then(() => logger('remote-sdk').info('whoa'))",
        '  .then(() => setTimeout(() => ws.close(), 100));'
      ].join('') + '"', (err, stdout, stderr) => {
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
      await expectAsync(fetch('http://localhost:5883'))
        .toBeRejectedWithError(/ECONNREFUSED/);
    });

    it('does not error when stopping', async () => {
      await expectAsync(percy.stop()).toBeResolved();
    });
  });
});
