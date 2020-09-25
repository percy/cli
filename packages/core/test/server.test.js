import expect from 'expect';
import fetch from 'node-fetch';
import PercyConfig from '@percy/config';
import Percy from '../src';

describe('Snapshot Server', () => {
  let percy;

  beforeEach(() => {
    percy = new Percy({
      token: 'PERCY_TOKEN',
      port: 1337
    });
  });

  afterEach(async () => {
    delete percy.stop; // remove own mocks
    await percy.stop();
  });

  it('has a default port', () => {
    expect(new Percy()).toHaveProperty('port', 5338);
  });

  it('can specify a custom port', () => {
    expect(percy).toHaveProperty('port', 1337);
  });

  it('starts a server at the specified port', async () => {
    await expect(percy.start()).resolves.toBeUndefined();
    await expect(fetch('http://localhost:1337')).resolves.toBeDefined();
  });

  it('has a /healthcheck endpoint', async () => {
    await percy.start();

    let response = await fetch('http://localhost:1337/percy/healthcheck');
    await expect(response.json()).resolves.toEqual({
      success: true,
      loglevel: 'error',
      config: PercyConfig.getDefaults(),
      build: {
        id: '123',
        number: 1,
        url: 'https://percy.io/test/test/123'
      }
    });
  });

  it('has an /idle endpoint that calls #idle()', async () => {
    await percy.start();
    percy.idle = async () => (
      percy.idle.calls = percy.idle.calls || []
    ).push(undefined);

    let response = await fetch('http://localhost:1337/percy/idle');
    await expect(response.json()).resolves.toEqual({ success: true });
    expect(percy.idle.calls).toHaveLength(1);
  });

  it('serves the @percy/dom bundle', async () => {
    let bundle = require('fs')
      .readFileSync(require.resolve('@percy/dom'), { encoding: 'utf-8' });

    await percy.start();
    let response = await fetch('http://localhost:1337/percy/dom.js');
    await expect(response.text()).resolves.toBe(bundle);
  });

  it('has a /stop endpoint that calls #stop()', async () => {
    await percy.start();
    percy.stop = async () => (
      percy.stop.calls = percy.stop.calls || []
    ).push(undefined);

    let response = await fetch('http://localhost:1337/percy/stop', { method: 'post' });
    await expect(response.json()).resolves.toEqual({ success: true });
    expect(percy.stop.calls).toHaveLength(1);
  });

  it('has a /snapshot endpoint that calls #snapshot()', async () => {
    await percy.start();
    percy.snapshot = async data => (
      percy.snapshot.calls = percy.snapshot.calls || []
    ).push(data);

    let response = await fetch('http://localhost:1337/percy/snapshot', {
      method: 'post',
      headers: { 'Content-Type': 'application/json' },
      body: '{ "test": true }'
    });

    await expect(response.json()).resolves.toEqual({ success: true });
    expect(percy.snapshot.calls).toHaveLength(1);
    expect(percy.snapshot.calls[0]).toEqual({ test: true });
  });

  it('returns a 500 error when an endpoint throws', async () => {
    await percy.start();
    percy.snapshot = () => Promise.reject(new Error('test error'));

    let response = await fetch('http://localhost:1337/percy/snapshot', {
      method: 'post',
      headers: { 'Content-Type': 'application/json' },
      body: '{ "test": true }'
    });

    await expect(response.json()).resolves.toEqual({
      success: false,
      error: 'test error'
    });
  });

  it('returns a 404 for any other endpoint', async () => {
    await percy.start();

    let response = await fetch('http://localhost:1337/foobar');
    expect(response).toHaveProperty('status', 404);

    await expect(response.json()).resolves.toEqual({
      success: false,
      error: 'Not found'
    });
  });

  it('accepts preflight cors checks', async () => {
    let called = false;

    await percy.start();
    percy.snapshot = async () => (called = true);

    let response = await fetch('http://localhost:1337/percy/snapshot', {
      method: 'OPTIONS'
    });

    expect(response.status).toBe(204);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(response.headers.get('Access-Control-Allow-Methods')).toBe('GET,POST');
    expect(called).toBe(false);
  });

  describe('when the server is disabled', () => {
    beforeEach(async () => {
      percy = await Percy.start({
        token: 'PERCY_TOKEN',
        server: false
      });
    });

    it('does not start a server with #start()', async () => {
      await expect(fetch('http://localhost:5883')).rejects.toThrow('ECONNREFUSED');
    });

    it('does not error when stopping', async () => {
      await expect(percy.stop()).resolves.toBeUndefined();
    });
  });
});
