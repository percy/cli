import utils from '@percy/sdk-utils';
import https from 'https';
import http from 'http';
import fs from 'fs';
import path from 'path';

// NOTE: Although sdk-utils test run in browser as well, we do not run sdk-utils/request test in browsers as we require creation of https server for this test
const ssl = {
  cert: fs.readFileSync(path.join(__dirname, 'assets', 'certs', 'test.crt')),
  key: fs.readFileSync(path.join(__dirname, 'assets', 'certs', 'test.key'))
};

// Returns the port number of a URL object. Defaults to port 443 for https
// protocols or port 80 otherwise.
function port(options) {
  if (options.port) return options.port;
  return options.protocol === 'https:' ? 443 : 80;
}

// Returns a string representation of a URL-like object
function href(options) {
  let { protocol, hostname, path, pathname, search, hash } = options;
  return `${protocol}//${hostname}:${port(options)}` +
    (path || `${pathname || ''}${search || ''}${hash || ''}`);
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

describe('Utils Requests', () => {
  let server;

  // Adding below env variables to support self signed certs
  beforeAll(() => {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  });

  afterAll(() => {
    delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  });

  beforeEach(async () => {
    server = await createTestServer({ type: 'https', port: 8080 }).start();
  });

  afterEach(async () => {
    await server?.close();
  });

  it('returns the successful response body', async () => {
    let res = await utils.request(server.address);
    expect(res.body).toBe('test');
  });

  describe('with proxy configuration', () => {
    let originalEnv;
    let proxyAgentFor;

    beforeEach(async () => {
      // Store original environment variables
      originalEnv = {
        HTTP_PROXY: process.env.HTTP_PROXY,
        HTTPS_PROXY: process.env.HTTPS_PROXY,
        http_proxy: process.env.http_proxy,
        https_proxy: process.env.https_proxy,
        NO_PROXY: process.env.NO_PROXY,
        no_proxy: process.env.no_proxy
      };

      // Clear proxy environment variables
      delete process.env.HTTP_PROXY;
      delete process.env.HTTPS_PROXY;
      delete process.env.http_proxy;
      delete process.env.https_proxy;
      delete process.env.NO_PROXY;
      delete process.env.no_proxy;

      // Import and clear proxy agent cache
      try {
        const proxyModule = await import('../src/proxy.js');
        proxyAgentFor = proxyModule.proxyAgentFor;
        if (proxyAgentFor && proxyAgentFor.cache) {
          proxyAgentFor.cache.clear();
        }
      } catch (e) {
        // Ignore if proxy module doesn't exist
      }
    });

    afterEach(() => {
      // Clear proxy agent cache again after each test
      if (proxyAgentFor && proxyAgentFor.cache) {
        proxyAgentFor.cache.clear();
      }

      // Restore original environment variables
      Object.keys(originalEnv).forEach(key => {
        if (originalEnv[key] !== undefined) {
          process.env[key] = originalEnv[key];
        } else {
          delete process.env[key];
        }
      });
    });

    it('makes request successfully when no proxy is configured', async () => {
      let res = await utils.request(server.address);
      expect(res.body).toBe('test');
    });

    it('skips proxy when hostname matches NO_PROXY', async () => {
      // Set proxy but exclude localhost from proxying
      process.env.https_proxy = 'http://nonexistent-proxy:8080';
      process.env.NO_PROXY = 'localhost,127.0.0.1';

      // Request should work because localhost is in NO_PROXY
      let res = await utils.request(server.address);
      expect(res.body).toBe('test');
    });

    it('handles proxy configuration gracefully when proxy is unavailable', async () => {
      // Set a proxy that doesn't exist
      process.env.https_proxy = 'http://nonexistent-proxy:8080';

      // The request should fail gracefully with a meaningful error
      try {
        await utils.request(server.address);
        // If we get here, the proxy was bypassed somehow
        fail('Expected request to fail with proxy error');
      } catch (error) {
        // Should be a meaningful proxy-related error
        expect(error.message).toMatch(/socket hang up|ENOTFOUND|ECONNREFUSED|EHOSTUNREACH|EAI_AGAIN|Connection closed/i);
      }
    });
  });
});
