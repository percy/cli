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

      // Use a non-localhost URL to ensure the proxy is actually used
      // (localhost is excluded by default to prevent internal loops)
      const externalUrl = 'https://example.com/test';

      // The request should fail gracefully with a meaningful error
      try {
        await utils.request(externalUrl);
        // If we get here, the proxy was bypassed somehow
        fail('Expected request to fail with proxy error');
      } catch (error) {
        // Should be a meaningful proxy-related error
        expect(error.message).toMatch(/socket hang up|ENOTFOUND|ECONNREFUSED|EHOSTUNREACH|EAI_AGAIN|Connection closed/i);
      }
    });

    it('does not set agent when proxyAgentFor returns null', async () => {
      // Clear proxy configuration and cache first
      delete process.env.https_proxy;
      delete process.env.http_proxy;
      if (proxyAgentFor && proxyAgentFor.cache) {
        proxyAgentFor.cache.clear();
      }

      // Test the specific case where proxyAgentFor returns null/undefined
      // This tests the falsy branch of the if (agent) condition
      const proxyModule = await import('../src/proxy.js');
      const originalProxyAgentFor = proxyModule.proxyAgentFor;

      // Replace proxyAgentFor with a version that returns null
      proxyModule.proxyAgentFor = () => null;

      // Spy on the https.request to verify agent is not set
      let capturedOptions;

      spyOn(https, 'request').and.callFake((url, options) => {
        capturedOptions = options;
        return {
          on: (event, callback) => {
            if (event === 'response') {
              const mockResponse = {
                statusCode: 200,
                statusMessage: 'OK',
                headers: {},
                on: (event, callback) => {
                  if (event === 'end') setTimeout(() => callback(), 0);
                  return mockResponse;
                }
              };
              setTimeout(() => callback(mockResponse), 0);
            }
            return {
              on: () => ({ end: () => ({}) }),
              end: () => ({})
            };
          },
          end: () => ({})
        };
      });

      try {
        // Make a request where proxyAgentFor returns null
        await utils.request(server.address);

        // Verify that no agent was set in request options due to null agent
        expect(capturedOptions).toBeDefined();
        expect(capturedOptions.agent).toBeUndefined();
      } finally {
        // Restore original proxyAgentFor function
        proxyModule.proxyAgentFor = originalProxyAgentFor;
      }
    });

    it('automatically excludes localhost requests from proxying', async () => {
      // Set proxy environment variables
      process.env.https_proxy = 'http://nonexistent-proxy:8080';
      process.env.http_proxy = 'http://nonexistent-proxy:8080';
      // Deliberately NOT setting NO_PROXY to test default localhost exclusion

      // Clear proxy agent cache to ensure fresh proxy decision
      if (proxyAgentFor && proxyAgentFor.cache) {
        proxyAgentFor.cache.clear();
      }

      // Request to localhost should work despite proxy being set to nonexistent server
      // This proves localhost is automatically excluded from proxying
      let res = await utils.request(server.address);
      expect(res.body).toBe('test');

      // Verify it was actually a localhost request
      expect(server.address).toContain('localhost');
    });
  });
});
