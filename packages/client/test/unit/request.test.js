import fs from 'fs';
import path from 'path';
import request, {
  href,
  ProxyHttpAgent,
  proxyAgentFor
} from '../../src/request';

const ssl = {
  cert: fs.readFileSync(path.resolve(__dirname, '../certs/test.crt')),
  key: fs.readFileSync(path.resolve(__dirname, '../certs/test.key'))
};

function createTestServer(options = {}, handler) {
  let { type = 'http', port = 8080 } = options;
  let { createServer } = require(type);
  let connections = new Set();
  let received = [];

  let address = new URL(href({
    protocol: `${type}:`,
    hostname: 'localhost',
    port
  })).href;

  let server = createServer(ssl, (req, res) => {
    req.on('data', chunk => {
      req.body = (req.body || '') + chunk;
    }).on('end', () => {
      received.push(req);
      if (handler) return handler(req, res);
      let [status = 200, body = 'test'] = (
        options.routes?.[req.url]?.(req, res) ?? []);
      if (!res.headersSent) res.writeHead(status).end(body);
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
    address,
    received,

    reply: (url, handler) => {
      (options.routes ||= {})[url] = handler;
    },

    request: (path, options) => {
      return request(new URL(path, address).href, {
        rejectUnauthorized: false,
        ...options
      });
    },

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

function createProxyServer({ type, port, ...options }) {
  let handleResponse = (req, res) => {
    let { connection, headers, url, method } = req;
    let proto = connection.encrypted ? 'https' : 'http';
    url = new URL(url, `${proto}://${headers.host}`);
    proto = url.protocol.slice(0, -1);

    if (options.shouldConnect && !options.shouldConnect(req)) {
      return res.writeHead(403).end();
    }

    require(proto).request(url.href, {
      method, headers, rejectUnauthorized: false
    }).on('response', remote => {
      let body = '';
      remote.setEncoding('utf8');
      remote.on('data', chunk => (body += chunk));
      remote.on('end', () => {
        let { statusCode, headers } = remote;
        res.writeHead(statusCode, headers).end(`${body} proxied`);
      });
    }).end(req.body);
  };

  let proxy = createTestServer({ type, port }, handleResponse);
  let mitmOpts = { type: options.mitm ?? type, port: port + 1 };
  let mitm = createTestServer(mitmOpts, handleResponse);
  let connects = [];

  proxy.server.on('connect', (req, client, head) => {
    // a shutdown error is sometimes thrown when the test proxy closes
    client.on('error', e => {});

    if (options.shouldConnect && !options.shouldConnect(req)) {
      client.write('HTTP/1.1 403 FORBIDDEN\r\n');
      client.write('\r\n'); // end headers
      return client.end();
    }

    let socket = require('net').connect({
      rejectUnauthorized: false,
      host: 'localhost',
      port: mitm.port
    }, () => {
      connects.push(req);
      client.write('HTTP/1.1 200 OK\r\n');
      client.write('\r\n'); // end headers
      socket.pipe(client);
      client.pipe(socket);
    });
  });

  return {
    options,
    connects,
    address: proxy.address,

    async start() {
      await Promise.all([proxy.start(), mitm.start()]);
      return this;
    },

    async close() {
      await Promise.all([proxy.close(), mitm.close()]);
    }
  };
}

function objectContaining(expected) {
  return jasmine.objectContaining(
    Object.entries(expected).reduce((exp, [k, v]) => {
      exp[k] = (Object.getPrototypeOf(v) === Object.prototype)
        ? objectContaining(v) : v;
      return exp;
    }, {}));
}

describe('Unit / Request', () => {
  let server;

  beforeEach(async () => {
    proxyAgentFor.cache?.clear();
    server = await createTestServer().start();
  });

  afterEach(async () => {
    await server?.close();
  });

  it('returns the successful response body', async () => {
    await expectAsync(request(server.address)).toBeResolvedTo('test');
  });

  it('accepts an incoming message handler', async () => {
    await expectAsync(request(server.address, (body, response) => {
      expect(response.statusCode).toBe(200);
      return `handled ${body}`;
    })).toBeResolvedTo('handled test');

    await expectAsync(request(server.address, () => {
      throw new Error('test error');
    })).toBeRejectedWithError('test error');
  });

  it('throws errors for unsuccessful requests', async () => {
    // detailed error message
    server.reply('/error', () => [403, JSON.stringify({
      errors: [{ detail: 'Not allowed' }]
    })]);

    await expectAsync(server.request('/error'))
      .toBeRejectedWithError('Not allowed');

    // default status message
    server.reply('/status', () => [403]);

    await expectAsync(server.request('/status'))
      .toBeRejectedWithError('403 Forbidden');

    // empty status message
    server.reply('/raw', (req, res) => {
      res.writeHead(403, '', {}).end('STOP');
    });

    await expectAsync(server.request('/raw'))
      .toBeRejectedWithError('403 STOP');
  });

  describe('retries', () => {
    let { OutgoingMessage } = require('http');

    it('automatically retries server 500 errors', async () => {
      let responses = [[502], [503], [520], [200]];
      server.reply('/test', () => responses.splice(0, 1)[0]);

      await expectAsync(server.request('/test'))
        .toBeResolvedTo('test');

      expect(responses.length).toBe(0);
      expect(server.received.length).toBe(4);
    });

    it('automatically retries specific request errors', async () => {
      let errors = ['ECONNREFUSED', 'EHOSTUNREACH', 'ECONNRESET', 'EAI_AGAIN'];
      let spy = spyOn(OutgoingMessage.prototype, 'end').and.callFake(function() {
        if (errors.length) this.emit('error', { code: errors.splice(0, 1)[0] });
        else OutgoingMessage.prototype.end.and.originalFn.apply(this, arguments);
      });

      await expectAsync(server.request('/test'))
        .toBeResolvedTo('test');

      expect(errors.length).toBe(0);
      expect(spy).toHaveBeenCalledTimes(6);
      expect(server.received.length).toBe(1);
    });

    it('optionally retries 404 not found errors', async () => {
      let responses = [[500], [404], [500], [404], [200]];
      server.reply('/test', () => responses.splice(0, 1)[0]);

      await expectAsync(server.request('/test'))
        .toBeRejectedWithError('404 Not Found');

      expect(responses).toEqual([[500], [404], [200]]);
      expect(server.received.length).toBe(2);

      await expectAsync(server.request('/test', {
        retryNotFound: true
      })).toBeResolvedTo('test');

      expect(responses.length).toBe(0);
      expect(server.received.length).toBe(5);
    });

    it('does not retry unknown errors', async () => {
      let spy = spyOn(OutgoingMessage.prototype, 'end').and
        .callFake(function() { this.emit('error', new Error('Unknown')); });

      await expectAsync(server.request('/idk'))
        .toBeRejectedWithError('Unknown');

      expect(spy).toHaveBeenCalledTimes(1);
    });

    it('fails retrying after 5 attempts', async () => {
      server.reply('/fail', () => [502]);
      await expectAsync(server.request('/fail'))
        .toBeRejectedWithError('502 Bad Gateway');
      expect(server.received.length).toBe(5);
    });
  });

  for (let serverType of ['http', 'https']) {
    describe(`proxying ${serverType} requests`, () => {
      beforeEach(async () => {
        await server?.close();

        server = await createTestServer({
          type: serverType
        }).start();
      });

      for (let proxyType of ['http', 'https']) {
        describe(`with an ${proxyType} proxy`, () => {
          let proxy, env;

          beforeEach(async () => {
            proxy = await createProxyServer({
              type: proxyType,
              mitm: serverType,
              port: 1337
            }).start();

            env = `${serverType}_proxy`.toUpperCase();
            process.env[env] = proxy.address;
          });

          afterEach(async () => {
            delete process.env[env];
            delete process.env[env.toLowerCase()];
            delete process.env.NO_PROXY;
            delete process.env.no_proxy;
            await proxy?.close();
          });

          it('successfully proxies requests', async () => {
            await expectAsync(server.request('/test', {
              headers: { 'x-foo-bar': 'xyzzy' }
            })).toBeResolvedTo('test proxied');

            await expectAsync(server.request('/test', {
              method: 'POST',
              body: 'foo-bar-baz'
            })).toBeResolvedTo('test proxied');

            expect(server.received).toEqual([
              objectContaining({
                url: '/test',
                method: 'GET',
                headers: {
                  'x-foo-bar': 'xyzzy'
                }
              }),
              objectContaining({
                url: '/test',
                method: 'POST',
                body: 'foo-bar-baz'
              })
            ]);
          });

          it('makes requests with basic proxy auth', async () => {
            process.env[env] = proxy.address
              .replace('://', '://user@');

            await expectAsync(server.request('/test'))
              .toBeResolvedTo('test proxied');

            process.env[env.toLowerCase()] = proxy.address
              .replace('://', '://user:pass@');
            delete process.env[env];
            proxyAgentFor.cache.clear();

            await expectAsync(server.request('/test', {
              headers: { authorization: 'Basic foobar:xyzzy' }
            })).toBeResolvedTo('test proxied');

            expect(
              serverType === 'https'
                ? proxy.connects : server.received
            ).toEqual([
              objectContaining({
                headers: { 'proxy-authorization': 'Basic dXNlcg==' }
              }),
              objectContaining({
                headers: { 'proxy-authorization': 'Basic dXNlcjpwYXNz' }
              })
            ]);

            expect(server.received).toEqual([
              objectContaining({ url: '/test' }),
              objectContaining({
                headers: { authorization: 'Basic foobar:xyzzy' }
              })
            ]);
          });

          it('does not proxy requests matching NO_PROXY', async () => {
            process.env.NO_PROXY = 'localhost';

            await expectAsync(server.request('/test'))
              .toBeResolvedTo('test');

            // coverage for multiple, empty, non-matching, and wildcard
            process.env.no_proxy = ', .example.com, localhost:3333, *';
            delete process.env.NO_PROXY;
            proxyAgentFor.cache.clear();

            await expectAsync(server.request('/test'))
              .toBeResolvedTo('test');

            expect(proxy.connects).toEqual([]);
          });

          it('does not proxy requests if the `noProxy` option is truthy', async () => {
            await expectAsync(server.request('/test', { noProxy: true }))
              .toBeResolvedTo('test');

            expect(proxy.connects).toEqual([]);
          });

          // the following test is not possible with the same localhost hostname when default server
          // and proxy ports match, but testing the remaining scenarios satisfies coverage
          if (serverType !== proxyType) {
            it('handles default proxy ports appropriately', async () => {
              await Promise.all([server.close(), proxy.close()]);
              let sPort = serverType === 'https' ? 443 : 80;
              let pPort = proxyType === 'https' ? 443 : 80;
              server = createTestServer({ type: serverType, port: sPort });
              proxy = createProxyServer({ type: proxyType, mitm: serverType, port: pPort });
              process.env[env] = proxy.address;

              // this check is done for systems with restricted ports
              let started = await Promise.resolve()
                .then(() => !!server.start())
                .then(() => !!proxy.start())
                .catch(e => false);

              // different request agents use different methods
              let spy = serverType === 'https'
                ? spyOn(require('tls'), 'connect').and.callThrough()
                : spyOn(require('http').Agent.prototype, 'addRequest').and.callThrough();

              // everything after the first expection is needed if the servers could not start on
              // their respective default ports due to system restrictions
              let serverRequest = server.request('/test');
              if (started) await expectAsync(serverRequest).toBeResolvedTo('test proxied');
              else await expectAsync(serverRequest).toBeRejected();
              let expectedOptions = objectContaining({ port: sPort });

              if (serverType === 'https') {
                expect(spy).toHaveBeenCalledWith(expectedOptions);
              } else {
                expect(spy).toHaveBeenCalledWith(jasmine.anything(), expectedOptions);
              }
            });
          }

          // the following test is specific to a condition in which http requests have already
          // connected to the server before the request is actually sent
          if (serverType === 'http') {
            it('handles delayed connections', async () => {
              class DelayedProxyHttpAgent extends ProxyHttpAgent {
                addRequest(request, options) {
                  // delay adding requests so `request.end()` is called before a socket is returned,
                  // which causes the headers to be generated before `ProxyHttpAgent` can patch the
                  // `request.path` property, which would then make the headers incorrect
                  setTimeout(() => super.addRequest(request, options), 10);
                }
              }

              await expectAsync(server.request('/test', {
                agent: new DelayedProxyHttpAgent()
              })).toBeResolvedTo('test proxied');
            });
          }

          // the following test is specific to how the https agent handles socket error events
          if (serverType === 'https') {
            it('throws unexpected connection errors', async () => {
              let error = new Error('Unexpected');

              // sabotage the underlying socket.write method to emit an error
              spyOn(require('net').Socket.prototype, 'write')
                .and.callFake(function() {
                  this.emit('error', error);
                });

              await expectAsync(server.request('/test'))
                .toBeRejectedWith(error);
            });
          }

          it('throws an error when unable to connect', async () => {
            proxy.options.shouldConnect = () => false;
            let serverRequest = server.request('/test');

            if (serverType === 'https') {
              // expect a socket connection error for https
              await expectAsync(serverRequest)
                .toBeRejectedWithError([
                  'Error establishing proxy connection.',
                  'Response from server was:',
                  'HTTP/1.1 403 FORBIDDEN\r\n\r\n'
                ].join(' '));
            } else {
              // expect a request error for http
              await expectAsync(serverRequest)
                .toBeRejectedWithError('403 Forbidden');
            }
          });
        });
      }

      describe('with other proxy protocols', () => {
        it('throws an error', async () => {
          process.env.HTTP_PROXY = 'socks5://localhost:1337';

          await expectAsync(server.request('/test'))
            .toBeRejectedWithError('Unsupported proxy protocol: socks5:');
        });
      });
    });
  }
});
