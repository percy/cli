import fs from 'fs';
import net from 'net';
import http from 'http';
import https from 'https';
import path from 'path';
import PercyClient from '../src';

const ssl = {
  cert: fs.readFileSync(path.join(__dirname, 'certs/test.crt')),
  key: fs.readFileSync(path.join(__dirname, 'certs/test.key'))
};

function createTestServer(http, port, handler) {
  let connections = new Set();
  let requests = [];

  let server = http.createServer(ssl, (req, res) => {
    req.on('data', chunk => {
      req.body = (req.body || '') + chunk;
    }).on('end', () => {
      requests.push(req);
      if (handler) handler(req, res);
      else res.writeHead(200, {}).end('test');
    });
  });

  server.on('connection', socket => {
    connections.add(socket.on('close', () => {
      connections.delete(socket);
    }));
  });

  return {
    port,
    server,
    requests,

    async start() {
      return new Promise((resolve, reject) => {
        server.listen(port, () => resolve(this))
          .on('error', reject);
      });
    },

    async close() {
      connections.forEach(s => s.destroy());
      await new Promise(r => server.close(r));
    }
  };
}

function createProxyServer(http, port, options = {}) {
  let connects = [];

  let proxy = createTestServer(http, port, (req, res) => {
    res.writeHead(405, {}).end('Method not allowed');
  });

  proxy.server.on('connect', (req, client, head) => {
    if (options.shouldConnect && !options.shouldConnect(req, client)) {
      client.write('HTTP/1.1 403 FORBIDDEN\r\n');
      client.write('\r\n'); // end headers
      return client.end();
    }

    let socket = net.connect({
      host: 'localhost',
      port: mitm.port,
      rejectUnauthorized: false
    }, () => {
      connects.push(req);
      client.write('HTTP/1.1 200 OK\r\n');
      client.write('\r\n'); // end headers
      socket.pipe(client);
      client.pipe(socket);
    });
  });

  let mitm = createTestServer(https, port + 1, (req, res) => {
    let { connection, headers, url, method } = req;
    url = `${connection.encrypted ? 'https' : 'http'}://${headers.host}${url}`;

    https.request(url, {
      method,
      headers,
      rejectUnauthorized: false
    }).on('response', remote => {
      remote.setEncoding('utf8');
      remote.on('data', chunk => (remote.body = (remote.body || '') + chunk));
      remote.on('end', () => {
        res.writeHead(remote.statusCode, remote.headers)
          .end(`${remote.body} proxied`);
      });
    }).end(req.body);
  });

  return {
    options,
    connects,

    async start() {
      await Promise.all([proxy.start(), mitm.start()]);
      return this;
    },

    async close() {
      await Promise.all([proxy.close(), mitm.close()]);
    }
  };
}

describe('Proxied PercyClient', () => {
  let proxy, server, client;

  beforeEach(async () => {
    process.env.HTTP_PROXY = 'http://localhost:1337';
    process.env.NO_PROXY = 'localhost:8081';

    proxy = await createProxyServer(http, 1337).start();
    server = await createTestServer(https, 8080).start();

    client = new PercyClient({
      token: 'PERCY_TOKEN',
      apiUrl: 'https://localhost:8080'
    });

    client.httpsAgent.rejectUnauthorized = false;
  });

  afterEach(async () => {
    delete process.env.HTTP_PROXY;
    delete process.env.HTTPS_PROXY;
    delete process.env.NO_PROXY;
    await server?.close();
    await proxy?.close();
  });

  it('is sent through the proxy', async () => {
    await expectAsync(client.get('foo'))
      .toBeResolvedTo('test proxied');
    expect(server.requests[0].url).toEqual('/foo');
    expect(server.requests[0].method).toBe('GET');
    expect(server.requests[0].headers).toEqual(
      jasmine.objectContaining({
        authorization: 'Token token=PERCY_TOKEN'
      })
    );

    await expectAsync(client.post('foo', { test: '123' }))
      .toBeResolvedTo('test proxied');
    expect(server.requests[1].url).toEqual('/foo');
    expect(server.requests[1].method).toBe('POST');
    expect(server.requests[1].body).toEqual('{"test":"123"}');
    expect(server.requests[1].headers).toEqual(
      jasmine.objectContaining({
        authorization: 'Token token=PERCY_TOKEN',
        'content-type': 'application/vnd.api+json'
      })
    );
  });

  it('is not proxied when matching NO_PROXY', async () => {
    process.env.NO_PROXY = 'localhost:8080';
    await expectAsync(client.get('foo')).toBeResolvedTo('test');
    expect(proxy.connects).toEqual([]);
  });

  it('is not proxied when the NO_PROXY list has a wildcard hostname', async () => {
    // test coverage for multiple, empty, non-matching, and wildcard
    process.env.NO_PROXY = ', .example.com, *';
    await expectAsync(client.get('foo')).toBeResolvedTo('test');
    expect(proxy.connects).toEqual([]);
  });

  it('is not proxied when not using a secure https api url', async () => {
    await server.close();
    server = await createTestServer(http, 8080).start();

    client = new PercyClient({
      token: 'PERCY_TOKEN',
      apiUrl: 'http://localhost:8080'
    });

    await client.get('foo');
    await expectAsync(client.get('foo')).toBeResolvedTo('test');
    expect(proxy.connects).toEqual([]);
  });

  it('is sent with basic proxy auth username', async () => {
    process.env.HTTP_PROXY = 'http://user@localhost:1337';
    await expectAsync(client.get('foo')).toBeResolvedTo('test proxied');

    expect(proxy.connects[0].headers).toEqual(
      jasmine.objectContaining({
        'proxy-authorization': 'basic dXNlcg=='
      })
    );
  });

  it('is sent with basic proxy auth username and password', async () => {
    process.env.HTTP_PROXY = 'http://user:pass@localhost:1337';
    await expectAsync(client.get('foo')).toBeResolvedTo('test proxied');

    expect(proxy.connects[0].headers).toEqual(
      jasmine.objectContaining({
        'proxy-authorization': 'basic dXNlcjpwYXNz'
      })
    );
  });

  it('can be proxied through an https proxy', async () => {
    proxy.close();

    proxy = await createProxyServer(https, 1337).start();
    process.env.HTTPS_PROXY = 'https://localhost:1337';

    await expectAsync(client.get('foo')).toBeResolvedTo('test proxied');
  });

  it('can be proxied through a proxy with a default port', async () => {
    proxy.close();

    // this is done for systems with restricted ports
    let failed = false;
    let spy = spyOn(require('net'), 'connect').and.callThrough();
    proxy = await createProxyServer(http, 80).start()
      .catch(() => { failed = true; });

    process.env.HTTP_PROXY = 'http://localhost';
    let req = client.get('foo');

    if (failed) await expectAsync(req).toBeRejected();
    else await expectAsync(req).toBeResolvedTo('test proxied');
    expect(spy).toHaveBeenCalledWith(jasmine.objectContaining({ port: 80 }));
  });

  it('can be proxied through an https proxy with a default port', async () => {
    proxy.close();

    // this is done for systems with restricted ports
    let failed = false;
    let spy = spyOn(require('tls'), 'connect').and.callThrough();
    proxy = await createProxyServer(https, 443).start()
      .catch(() => { failed = true; });

    process.env.HTTPS_PROXY = 'https://localhost';
    let req = client.get('foo');

    if (failed) await expectAsync(req).toBeRejected();
    else await expectAsync(req).toBeResolvedTo('test proxied');
    expect(spy).toHaveBeenCalledWith(jasmine.objectContaining({ port: 443 }));
  });

  it('throws an error for unsupported proxy protocols', async () => {
    process.env.HTTP_PROXY = 'socks5://localhost:1337';

    await expectAsync(client.get('foo'))
      .toBeRejectedWithError('Unsupported proxy protocol: socks5:');
  });

  it('throws unexpected connection errors', async () => {
    let err = new Error('Unexpected');

    spyOn(net.Socket.prototype, 'write')
      .and.callFake(function() { this.emit('error', err); });

    await expectAsync(client.get('foo')).toBeRejectedWith(err);
  });

  it('throws when the proxy connection can not be established', async () => {
    proxy.options.shouldConnect = () => false;

    await expectAsync(client.get('foo')).toBeRejectedWithError([
      'Error establishing proxy connection.',
      'Response from server was:',
      'HTTP/1.1 403 FORBIDDEN\r\n\r\n'
    ].join(' '));
  });
});
