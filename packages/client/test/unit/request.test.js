import fs from 'fs';
import net from 'net';
import http from 'http';
import https from 'https';
import { request, ProxyHttpAgent, formatBytes } from '@percy/client/utils';
import { port, href, proxyAgentFor } from '../../src/proxy.js';
import logger from '@percy/logger/test/helpers';

const ssl = {
  cert: fs.readFileSync('./test/certs/test.crt'),
  key: fs.readFileSync('./test/certs/test.key')
};

function createTestServer({ type = 'http', ...options } = {}, handler) {
  let { createServer } = type === 'http' ? http : https;
  let connections = new Set();
  let received = [];

  let url = new URL(href({
    protocol: `${type}:`,
    hostname: 'localhost',
    port: options.port
  }));

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
    server,
    received,
    port: port(url),
    address: url.href,

    reply: (url, handler) => {
      (options.routes ||= {})[url] = handler;
    },

    request: (path, options) => {
      return request(new URL(path, url).href, {
        rejectUnauthorized: false,
        ...options
      });
    },

    async start() {
      return new Promise((resolve, reject) => {
        server.listen(this.port)
          .on('listening', () => resolve(this))
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

    (proto === 'http' ? http : https).request(url.href, {
      method, headers, rejectUnauthorized: false
    }).on('response', remote => {
      let body = '';
      remote.setEncoding('utf-8');
      remote.on('data', chunk => (body += chunk));
      remote.on('end', () => {
        let { statusCode, headers } = remote;
        res.writeHead(statusCode, headers).end(`${body} proxied`);
      });
    }).end(req.body);
  };

  let proxy = createTestServer({ type, port }, handleResponse);
  let mitmOpts = { type: options.mitm ?? type, port: proxy.port + 1 };
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

    let socket = net.connect({
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
    server = await createTestServer({ port: 8080 }).start();
  });

  afterEach(async () => {
    await server?.close();
  });

  it('returns the successful response body', async () => {
    await expectAsync(request(server.address)).toBeResolvedTo('test');
  });

  it('updates meta with status if passed', async () => {
    const meta = { abc: 1 };
    await expectAsync(request(server.address, { meta })).toBeResolvedTo('test');
    expect(meta).toEqual({ abc: 1, responseCode: 200, xRequestId: undefined, cfRay: undefined });
  });

  it('returns the successful response body as a buffer', async () => {
    await expectAsync(request(server.address, { buffer: true })).toBeResolvedTo(Buffer.from('test'));
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
      .toBeRejectedWithError('403 Forbidden\ntest');

    // empty status message
    server.reply('/raw', (req, res) => {
      res.writeHead(403, '', {}).end('STOP');
    });

    await expectAsync(server.request('/raw'))
      .toBeRejectedWithError('403 \nSTOP');
  });

  describe('retries', () => {
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
      let spy = spyOn(http.OutgoingMessage.prototype, 'end').and.callFake(function() {
        if (errors.length) this.emit('error', { code: errors.splice(0, 1)[0] });
        else http.OutgoingMessage.prototype.end.and.originalFn.apply(this, arguments);
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
        .toBeRejectedWithError('404 Not Found\ntest');

      expect(responses).toEqual([[500], [404], [200]]);
      expect(server.received.length).toBe(2);

      await expectAsync(server.request('/test', {
        retryNotFound: true
      })).toBeResolvedTo('test');

      expect(responses.length).toBe(0);
      expect(server.received.length).toBe(5);
    });

    it('does not retry unknown errors', async () => {
      let spy = spyOn(http.OutgoingMessage.prototype, 'end').and
        .callFake(function() { this.emit('error', new Error('Unknown')); });

      await expectAsync(server.request('/idk'))
        .toBeRejectedWithError('Unknown');

      expect(spy).toHaveBeenCalledTimes(1);
    });

    it('fails after 5 additional retries', async () => {
      server.reply('/fail', () => [502]);
      await expectAsync(server.request('/fail'))
        .toBeRejectedWithError('502 Bad Gateway\ntest');
      expect(server.received.length).toBe(6);
    });

    it('updates meta on failure', async () => {
      const meta = { abc: 1 };
      server.reply('/fail', () => [502]);
      await expectAsync(server.request('/fail', { meta }))
        .toBeRejectedWithError('502 Bad Gateway\ntest');
      expect(server.received.length).toBe(6);
      expect(meta).toEqual({
        abc: 1,
        responseCode: 502,
        xRequestId: undefined,
        cfRay: undefined,
        errorCount: 6
      });
    });

    it('automatically retries 409 conflict errors', async () => {
      let responses = [[409], [409], [200]];
      server.reply('/test', () => responses.splice(0, 1)[0]);

      await expectAsync(server.request('/test'))
        .toBeResolvedTo('test');

      expect(responses.length).toBe(0);
      expect(server.received.length).toBe(3);
    });
  });

  for (let serverType of ['http', 'https']) {
    describe(`proxying ${serverType} requests`, () => {
      let env = `${serverType}_proxy`.toUpperCase();

      beforeEach(async () => {
        await server?.close();
        await logger.mock({ level: 'debug' });
        server = await createTestServer({
          type: serverType,
          port: 8080
        }).start();
      });

      for (let proxyType of ['http', 'https']) {
        describe(`with an ${proxyType} proxy`, () => {
          let proxy;

          beforeEach(async () => {
            delete process.env[env];
            delete process.env[env.toLowerCase()];
            delete process.env.NO_PROXY;
            delete process.env.no_proxy;

            proxy = await createProxyServer({
              type: proxyType,
              mitm: serverType,
              port: 1337
            }).start();

            process.env[env] = proxy.address;
          });

          afterEach(async () => {
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

            delete process.env[env];
            process.env[env.toLowerCase()] = proxy.address
              .replace('://', '://user:pass@');
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
            delete process.env.NO_PROXY;
            process.env.no_proxy = ', .example.com, localhost:3333, *';
            proxyAgentFor.cache.clear();

            await expectAsync(server.request('/test'))
              .toBeResolvedTo('test');

            expect(proxy.connects).toEqual([]);
          });

          it('successfully proxies requests when `noProxy` is null or not string', async () => {
            process.env.no_proxy = null;
            proxyAgentFor.cache.clear();

            await expectAsync(server.request('/test'))
              .toBeResolvedTo('test proxied');

            process.env.no_proxy = 1234;
            proxyAgentFor.cache.clear();

            await expectAsync(server.request('/test'))
              .toBeResolvedTo('test proxied');
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
              server = createTestServer({ type: serverType });
              proxy = createProxyServer({ type: proxyType, mitm: serverType });
              process.env[env] = proxy.address;

              // this check is done for systems with restricted ports
              let started = await Promise.all([
                server.start(), proxy.start()
              ]).then(() => true, () => false);

              // different request agents need different spies
              let spy = serverType === 'https'
                ? spyOn(net.Socket.prototype, 'write')
                : spyOn(http.Agent.prototype, 'addRequest');
              spy.and.callThrough();

              // only expected to resolve when the servers are running
              let expected = expectAsync(server.request());
              if (started) await expected.toBeResolvedTo('test proxied');
              else await expected.toBeRejected();

              // different request agents have different spies
              if (serverType === 'https') {
                expect(spy).toHaveBeenCalledWith([
                  'CONNECT localhost:443 HTTP/1.1',
                  'Host: localhost:443'
                ].join('\r\n') + '\r\n\r\n');
              } else {
                let [req] = spy.calls.argsFor(0);
                expect(req.getHeader('host')).toBe('localhost');
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
              spyOn(net.Socket.prototype, 'write')
                .and.callFake(function() {
                  this.emit('error', error);
                });

              await expectAsync(server.request('/test'))
                .toBeRejectedWith(error);
            });

            if (proxyType === 'https') {
              it('throws EHOSTUNREACH error', async () => {
                let error = new Error('EHOSTUNREACH');

                // sabotage the underlying socket.write method to emit an error
                spyOn(net.Socket.prototype, 'write')
                  .and.callFake(function() {
                    this.emit('error', error);
                  });

                await expectAsync(server.request('/test'))
                  .toBeRejectedWith(error);

                expect(logger.stderr).toEqual(jasmine.arrayContaining([
                  `[percy:client:proxy] Proxying request https://localhost:8080 failed: ${error}`,
                  '[percy:client:proxy] If needed, Please verify if your proxy credentials are correct',
                  '[percy:client:proxy] Please check if your proxy is set correctly and reachable'
                ]));
              });
            }
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
          process.env[env] = 'socks5://localhost:1337';

          await expectAsync(server.request('/test'))
            .toBeRejectedWithError('Unsupported proxy protocol: socks5:');
        });
      });
    });
  }
});

describe('Unit / formatBytes', () => {
  it('returns correct format', () => {
    expect(formatBytes(500)).toBe('500B');
    expect(formatBytes(1024)).toBe('1.0kB');
    expect(formatBytes(750 * 1024)).toBe('750.0kB');
    expect(formatBytes(500 * 1024 * 1024)).toBe('500.0MB');
  });
});
