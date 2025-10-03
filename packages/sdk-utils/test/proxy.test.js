// NOTE: Proxy tests only run in Node.js environments since they use Node.js-specific modules
// This file is excluded from browser tests in karma.config.cjs
import {
  hostnameMatches,
  port,
  href,
  getProxy,
  ProxyHttpAgent,
  ProxyHttpsAgent,
  proxyAgentFor,
  createPacAgent
} from '../src/proxy.js';
import { PacProxyAgent } from 'pac-proxy-agent';
import http from 'http';
import https from 'https';
import net from 'net';
import tls from 'tls';
import logger from '../src/logger.js';

describe('sdk-utils proxy', () => {
  let originalEnv;

  beforeEach(() => {
    // Store original environment variables
    originalEnv = {
      HTTP_PROXY: process.env.HTTP_PROXY,
      HTTPS_PROXY: process.env.HTTPS_PROXY,
      http_proxy: process.env.http_proxy,
      https_proxy: process.env.https_proxy,
      NO_PROXY: process.env.NO_PROXY,
      no_proxy: process.env.no_proxy,
      PERCY_PAC_FILE_URL: process.env.PERCY_PAC_FILE_URL
    };

    // Clear all proxy environment variables
    delete process.env.HTTP_PROXY;
    delete process.env.HTTPS_PROXY;
    delete process.env.http_proxy;
    delete process.env.https_proxy;
    delete process.env.NO_PROXY;
    delete process.env.no_proxy;
    delete process.env.PERCY_PAC_FILE_URL;

    // Clear proxy agent cache
    if (proxyAgentFor && proxyAgentFor.cache) {
      proxyAgentFor.cache.clear();
    }
  });

  afterEach(() => {
    // Clear proxy agent cache
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

  describe('utility functions', () => {
    describe('hostnameMatches', () => {
      it('returns true for exact hostname matches', () => {
        expect(hostnameMatches('example.com', 'http://example.com')).toBe(true);
        expect(hostnameMatches('example.com:8080', 'http://example.com:8080')).toBe(true);
      });

      it('returns false for non-matching hostnames', () => {
        expect(hostnameMatches('example.com', 'http://other.com')).toBe(false);
        expect(hostnameMatches('example.com:8080', 'http://example.com:3000')).toBe(false);
      });

      it('supports wildcard patterns', () => {
        expect(hostnameMatches('*', 'http://example.com')).toBe(true);
        expect(hostnameMatches('*.example.com', 'http://sub.example.com')).toBe(true);
        expect(hostnameMatches('.example.com', 'http://sub.example.com')).toBe(true);
      });

      it('supports comma-separated patterns', () => {
        expect(hostnameMatches('localhost,127.0.0.1', 'http://localhost')).toBe(true);
        expect(hostnameMatches('localhost,127.0.0.1', 'http://127.0.0.1')).toBe(true);
        expect(hostnameMatches('localhost,127.0.0.1', 'http://example.com')).toBe(false);
      });

      it('supports array of patterns', () => {
        expect(hostnameMatches(['localhost', '127.0.0.1'], 'http://localhost')).toBe(true);
        expect(hostnameMatches(['localhost', '127.0.0.1'], 'http://example.com')).toBe(false);
      });

      it('handles empty patterns gracefully', () => {
        expect(hostnameMatches('', 'http://example.com')).toBe(false);
        expect(hostnameMatches([], 'http://example.com')).toBe(false);
      });
    });

    describe('port', () => {
      it('returns the port if specified', () => {
        expect(port({ port: 8080 })).toBe(8080);
        expect(port({ port: '3000' })).toBe('3000');
      });

      it('returns 443 for https protocols', () => {
        expect(port({ protocol: 'https:' })).toBe(443);
      });

      it('returns 80 for non-https protocols', () => {
        expect(port({ protocol: 'http:' })).toBe(80);
        expect(port({ protocol: 'ftp:' })).toBe(80);
        expect(port({})).toBe(80);
      });
    });

    describe('href', () => {
      it('constructs URL from options with port', () => {
        const options = {
          protocol: 'https:',
          hostname: 'example.com',
          port: 8080,
          path: '/api/test'
        };
        expect(href(options)).toBe('https://example.com:8080/api/test');
      });

      it('constructs URL with default ports', () => {
        expect(href({
          protocol: 'https:',
          hostname: 'example.com',
          pathname: '/test',
          search: '?q=1'
        })).toBe('https://example.com:443/test?q=1');
      });

      it('handles missing path components', () => {
        expect(href({
          protocol: 'http:',
          hostname: 'example.com'
        })).toBe('http://example.com:80');
      });
    });

    describe('getProxy', () => {
      it('returns undefined when no proxy is configured', () => {
        const options = { protocol: 'http:', hostname: 'example.com' };
        expect(getProxy(options)).toBeUndefined();
      });

      it('returns proxy object for http requests with http_proxy', () => {
        process.env.http_proxy = 'http://proxy.example.com:8080';
        const options = { protocol: 'http:', hostname: 'example.com' };
        const proxy = getProxy(options);

        expect(proxy).toBeDefined();
        expect(proxy.host).toBe('proxy.example.com');
        expect(proxy.port).toBe('8080');
        expect(proxy.isHttps).toBe(false);
        expect(proxy.auth).toBeFalsy();
      });

      it('returns proxy object for https requests with https_proxy', () => {
        process.env.https_proxy = 'http://proxy.example.com:8080';
        const options = { protocol: 'https:', hostname: 'example.com' };
        const proxy = getProxy(options);

        expect(proxy).toBeDefined();
        expect(proxy.host).toBe('proxy.example.com');
        expect(proxy.port).toBe('8080');
        expect(proxy.isHttps).toBe(false);
      });

      it('supports uppercase environment variables', () => {
        process.env.HTTPS_PROXY = 'http://proxy.example.com:3128';
        const options = { protocol: 'https:', hostname: 'example.com' };
        const proxy = getProxy(options);

        expect(proxy).toBeDefined();
        expect(proxy.host).toBe('proxy.example.com');
        expect(proxy.port).toBe('3128');
      });

      it('includes auth when proxy URL has credentials', () => {
        process.env.http_proxy = 'http://user:pass@proxy.example.com:8080';
        const options = { protocol: 'http:', hostname: 'example.com' };
        const proxy = getProxy(options);

        expect(proxy).toBeDefined();
        expect(proxy.auth).toBeTruthy();
        expect(proxy.auth).toMatch(/^Basic /);
      });

      it('includes auth when proxy URL has username only', () => {
        process.env.http_proxy = 'http://user@proxy.example.com:8080';
        const options = { protocol: 'http:', hostname: 'example.com' };
        const proxy = getProxy(options);

        expect(proxy).toBeDefined();
        expect(proxy.auth).toBeTruthy();
        expect(proxy.auth).toMatch(/^Basic /);
      });

      it('supports https proxy URLs', () => {
        process.env.http_proxy = 'https://proxy.example.com:8080';
        const options = { protocol: 'http:', hostname: 'example.com' };
        const proxy = getProxy(options);

        expect(proxy).toBeDefined();
        expect(proxy.isHttps).toBe(true);
      });

      it('throws error for unsupported proxy protocols', () => {
        process.env.http_proxy = 'socks5://proxy.example.com:1080';
        const options = { protocol: 'http:', hostname: 'example.com' };

        expect(() => getProxy(options)).toThrow();

        // Verify the error message contains the expected text
        try {
          getProxy(options);
        } catch (error) {
          expect(error.message).toContain('Unsupported proxy protocol: socks5:');
        }
      });

      it('respects NO_PROXY environment variable', () => {
        process.env.http_proxy = 'http://proxy.example.com:8080';
        process.env.NO_PROXY = 'localhost,127.0.0.1,example.com';

        const options = { protocol: 'http:', hostname: 'example.com' };
        expect(getProxy(options)).toBeUndefined();

        const options2 = { protocol: 'http:', hostname: 'other.com' };
        expect(getProxy(options2)).toBeDefined();
      });

      it('respects no_proxy environment variable (lowercase)', () => {
        process.env.http_proxy = 'http://proxy.example.com:8080';
        process.env.no_proxy = 'localhost,127.0.0.1,example.com';

        const options = { protocol: 'http:', hostname: 'example.com' };
        expect(getProxy(options)).toBeUndefined();
      });

      it('strips quotes and spaces from proxy URLs', () => {
        process.env.http_proxy = '  "http://proxy.example.com:8080"  ';
        const options = { protocol: 'http:', hostname: 'example.com' };
        const proxy = getProxy(options);

        expect(proxy).toBeDefined();
        expect(proxy.host).toBe('proxy.example.com');
      });

      it('provides connect function for socket connection', () => {
        process.env.http_proxy = 'http://proxy.example.com:8080';
        const options = { protocol: 'http:', hostname: 'example.com' };
        const proxy = getProxy(options);

        expect(proxy).toBeDefined();
        expect(typeof proxy.connect).toBe('function');
      });

      it('uses tls.connect when proxy URL uses https protocol', () => {
        process.env.http_proxy = 'https://proxy.example.com:8080';
        const options = { protocol: 'http:', hostname: 'example.com' };
        const proxy = getProxy(options);

        expect(proxy).toBeDefined();
        expect(proxy.isHttps).toBe(true);
        expect(typeof proxy.connect).toBe('function');

        // Spy on tls.connect to verify it's called
        spyOn(tls, 'connect');
        proxy.connect();
        expect(tls.connect).toHaveBeenCalledWith({
          rejectUnauthorized: options.rejectUnauthorized,
          host: proxy.host,
          port: proxy.port
        });
      });
    });
  });

  describe('ProxyHttpAgent', () => {
    let agent;

    beforeEach(() => {
      agent = new ProxyHttpAgent();
    });

    it('should be an instance of http.Agent', () => {
      expect(agent).toBeInstanceOf(http.Agent);
    });

    it('should have an httpsAgent property', () => {
      expect(agent.httpsAgent).toBeInstanceOf(https.Agent);
      expect(agent.httpsAgent.keepAlive).toBe(true);
    });

    it('should call super.addRequest when no proxy is configured', () => {
      const mockRequest = {
        setHeader: jasmine.createSpy('setHeader'),
        _implicitHeader: jasmine.createSpy('_implicitHeader'),
        outputData: []
      };
      const options = { protocol: 'http:', hostname: 'example.com', href: 'http://example.com' };

      spyOn(http.Agent.prototype, 'addRequest');
      agent.addRequest(mockRequest, options);

      expect(http.Agent.prototype.addRequest).toHaveBeenCalledWith(mockRequest, options);
    });

    it('should modify request path when proxy is configured', () => {
      process.env.http_proxy = 'http://proxy.example.com:8080';

      const mockRequest = {
        path: '/api/test',
        setHeader: jasmine.createSpy('setHeader'),
        _implicitHeader: jasmine.createSpy('_implicitHeader'),
        outputData: []
      };
      const options = {
        protocol: 'http:',
        hostname: 'example.com',
        href: 'http://example.com/api/test',
        port: 80,
        path: '/api/test'
      };

      spyOn(http.Agent.prototype, 'addRequest');
      agent.addRequest(mockRequest, options);

      expect(mockRequest.path).toBe('http://example.com:80/api/test');
    });

    it('should set Proxy-Authorization header when proxy has auth', () => {
      process.env.http_proxy = 'http://user:pass@proxy.example.com:8080';

      const mockRequest = {
        path: '/api/test',
        setHeader: jasmine.createSpy('setHeader'),
        _implicitHeader: jasmine.createSpy('_implicitHeader'),
        outputData: []
      };
      const options = {
        protocol: 'http:',
        hostname: 'example.com',
        href: 'http://example.com/api/test'
      };

      spyOn(http.Agent.prototype, 'addRequest');
      agent.addRequest(mockRequest, options);

      expect(mockRequest.setHeader).toHaveBeenCalledWith('Proxy-Authorization', jasmine.any(String));
    });

    it('should use httpsAgent for https proxy', () => {
      process.env.http_proxy = 'https://proxy.example.com:8080';

      const mockRequest = {
        path: '/api/test',
        setHeader: jasmine.createSpy('setHeader'),
        _implicitHeader: jasmine.createSpy('_implicitHeader'),
        outputData: [],
        agent: null
      };
      const options = {
        protocol: 'http:',
        hostname: 'example.com',
        href: 'http://example.com/api/test'
      };

      spyOn(agent.httpsAgent, 'addRequest');
      agent.addRequest(mockRequest, options);

      expect(mockRequest.agent).toBe(agent.httpsAgent);
      expect(agent.httpsAgent.addRequest).toHaveBeenCalled();
    });

    it('should handle request with existing outputData', () => {
      process.env.http_proxy = 'http://proxy.example.com:8080';

      const mockRequest = {
        path: '/api/test',
        setHeader: jasmine.createSpy('setHeader'),
        _implicitHeader: jasmine.createSpy('_implicitHeader'),
        _header: 'GET /api/test HTTP/1.1\r\nHost: example.com\r\n\r\n',
        outputData: [{
          data: 'GET /api/test HTTP/1.1\r\nHost: example.com\r\n\r\nrequest body'
        }]
      };
      const options = {
        protocol: 'http:',
        hostname: 'example.com',
        href: 'http://example.com/api/test'
      };

      spyOn(http.Agent.prototype, 'addRequest');
      agent.addRequest(mockRequest, options);

      expect(mockRequest.outputData[0].data).toContain('request body');
    });
  });

  describe('ProxyHttpsAgent', () => {
    let agent;

    beforeEach(() => {
      agent = new ProxyHttpsAgent();
    });

    it('should be an instance of https.Agent', () => {
      expect(agent).toBeInstanceOf(https.Agent);
    });

    it('should have keepAlive enabled by default', () => {
      expect(agent.keepAlive).toBe(true);
    });

    it('should accept custom options', () => {
      const customAgent = new ProxyHttpsAgent({ maxSockets: 10 });
      expect(customAgent.maxSockets).toBe(10);
      expect(customAgent.keepAlive).toBe(true); // should still have keepAlive
    });

    it('should call super.createConnection when no proxy is configured', () => {
      const options = { hostname: 'example.com', port: 443 };
      const callback = jasmine.createSpy('callback');

      spyOn(https.Agent.prototype, 'createConnection');
      agent.createConnection(options, callback);

      expect(https.Agent.prototype.createConnection).toHaveBeenCalledWith(options, callback);
    });

    it('should handle proxy connection setup', () => {
      // This test verifies that the ProxyHttpsAgent can be instantiated
      // and has the expected structure for proxy connections
      // Full integration testing of proxy connections is complex and
      // better handled by integration tests
      expect(typeof agent.createConnection).toBe('function');
    });

    it('should add Proxy-Authorization header when proxy has auth in createConnection', (done) => {
      process.env.https_proxy = 'http://user:pass@proxy.example.com:8080';

      const mockSocket = {};
      mockSocket.on = jasmine.createSpy('on').and.returnValue(mockSocket);
      mockSocket.write = jasmine.createSpy('write');
      mockSocket.destroy = jasmine.createSpy('destroy');
      mockSocket.off = jasmine.createSpy('off');

      // Mock net.connect to return our mock socket
      spyOn(net, 'connect').and.returnValue(mockSocket);

      const options = {
        protocol: 'https:',
        hostname: 'example.com',
        port: 443
      };
      const callback = jasmine.createSpy('callback');

      agent.createConnection(options, callback);

      // Verify that the connect message includes Proxy-Authorization
      setTimeout(() => {
        const writeCall = mockSocket.write.calls.first();
        expect(writeCall).toBeDefined();
        expect(writeCall.args[0]).toContain('Proxy-Authorization: Basic');
        done();
      }, 0);
    });

    it('should handle ECONNREFUSED and EHOSTUNREACH errors with specific warnings', (done) => {
      process.env.https_proxy = 'http://proxy.example.com:8080';

      // Spy on the logger.log method to catch the warn calls
      const logSpy = spyOn(logger, 'log');

      const mockSocket = {};
      mockSocket.on = jasmine.createSpy('on').and.callFake((event, handler) => {
        if (event === 'error') {
          // Simulate ECONNREFUSED error
          setTimeout(() => handler(new Error('connect ECONNREFUSED 127.0.0.1:8080')), 0);
        }
        return mockSocket;
      });
      mockSocket.write = jasmine.createSpy('write');
      mockSocket.destroy = jasmine.createSpy('destroy');
      mockSocket.off = jasmine.createSpy('off');

      spyOn(net, 'connect').and.returnValue(mockSocket);

      const options = {
        protocol: 'https:',
        hostname: 'example.com',
        port: 443
      };
      const callback = jasmine.createSpy('callback');

      agent.createConnection(options, callback);

      // Wait for async error handling
      setTimeout(() => {
        const warnCalls = logSpy.calls.all().filter(call => call.args[1] === 'warn');
        expect(warnCalls.length).toBeGreaterThan(0);
        const warnMessages = warnCalls.map(call => call.args[2]);
        expect(warnMessages).toContain('If needed, please verify that your proxy credentials are correct.');
        expect(warnMessages).toContain('Please check that your proxy is configured correctly and reachable.');
        done();
      }, 20);
    });

    it('should handle non-200 proxy response correctly', (done) => {
      process.env.https_proxy = 'http://proxy.example.com:8080';

      const mockSocket = {
        on: jasmine.createSpy('on').and.callFake((event, handler) => {
          if (event === 'data') {
            // Simulate non-200 response
            setTimeout(() => handler(Buffer.from('HTTP/1.1 407 Proxy Authentication Required\r\n\r\n')), 0);
          }
          return mockSocket;
        }),
        write: jasmine.createSpy('write'),
        destroy: jasmine.createSpy('destroy'),
        off: jasmine.createSpy('off')
      };

      spyOn(net, 'connect').and.returnValue(mockSocket);

      const options = {
        protocol: 'https:',
        hostname: 'example.com',
        port: 443
      };
      const callback = jasmine.createSpy('callback');

      agent.createConnection(options, callback);

      // Wait for async data handling
      setTimeout(() => {
        expect(callback).toHaveBeenCalledWith(jasmine.objectContaining({
          message: jasmine.stringMatching(/Error establishing proxy connection/)
        }));
        done();
      }, 10);
    });

    it('should handle successful proxy connection', (done) => {
      process.env.https_proxy = 'http://proxy.example.com:8080';

      const mockSocket = {
        on: jasmine.createSpy('on').and.callFake((event, handler) => {
          if (event === 'data') {
            // Simulate successful 200 response
            setTimeout(() => handler(Buffer.from('HTTP/1.1 200 Connection established\r\n\r\n')), 0);
          }
          return mockSocket;
        }),
        write: jasmine.createSpy('write'),
        destroy: jasmine.createSpy('destroy'),
        off: jasmine.createSpy('off')
      };

      spyOn(net, 'connect').and.returnValue(mockSocket);
      spyOn(https.Agent.prototype, 'createConnection').and.returnValue({});

      const options = {
        protocol: 'https:',
        hostname: 'example.com',
        port: 443
      };
      const callback = jasmine.createSpy('callback');

      agent.createConnection(options, callback);

      // Wait for async data handling
      setTimeout(() => {
        expect(options.socket).toBe(mockSocket);
        expect(options.servername).toBe('example.com');
        expect(callback).toHaveBeenCalledWith(null, jasmine.any(Object));
        done();
      }, 10);
    });

    it('should handle connection close during proxy setup', (done) => {
      process.env.https_proxy = 'http://proxy.example.com:8080';

      const mockSocket = {
        on: jasmine.createSpy('on').and.callFake((event, handler) => {
          if (event === 'close') {
            // Immediately call the close handler to simulate a closed connection
            handler();
          }
          return mockSocket;
        }),
        write: jasmine.createSpy('write'),
        destroy: jasmine.createSpy('destroy'),
        off: jasmine.createSpy('off')
      };

      spyOn(net, 'connect').and.returnValue(mockSocket);

      const options = {
        protocol: 'https:',
        hostname: 'example.com',
        port: 443
      };

      const callback = (err) => {
        expect(err).toBeInstanceOf(Error);
        expect(err.message).toBe('Connection closed while sending request to upstream proxy');
        done();
      };

      agent.createConnection(options, callback);
    });

    it('should handle incomplete proxy response headers', (done) => {
      process.env.https_proxy = 'http://proxy.example.com:8080';

      const mockSocket = {
        on: jasmine.createSpy('on').and.callFake((event, handler) => {
          if (event === 'data') {
            // Simulate receiving incomplete data
            handler('HTTP/1.1 200 OK\r\n');
          }
          return mockSocket;
        }),
        write: jasmine.createSpy('write'),
        destroy: jasmine.createSpy('destroy'),
        off: jasmine.createSpy('off')
      };

      spyOn(net, 'connect').and.returnValue(mockSocket);

      const options = {
        protocol: 'https:',
        hostname: 'example.com',
        port: 443
      };

      const callback = jasmine.createSpy('callback');

      agent.createConnection(options, callback);

      // Let the event loop run to see if anything happens
      setTimeout(() => {
        expect(callback).not.toHaveBeenCalled();
        done();
      }, 100);
    });
  });

  describe('createPacAgent', () => {
    it('should create a PAC proxy agent successfully', () => {
      const pacUrl = 'http://example.com/proxy.pac';
      const options = { keepAlive: true };
      const agent = createPacAgent(pacUrl, options);
      expect(agent).toBeInstanceOf(PacProxyAgent);
    });

    it('should throw an error if PAC proxy agent creation fails', () => {
      const pacUrl = 'http://invalid-url/proxy.pac';
      const options = { keepAlive: true };
      createPacAgent(pacUrl, options);
      expect(createPacAgent).toThrow();
    });

    it('should not throw an error if PAC proxy agent creation with invalid URL', () => {
      const pacUrl = 'invalid-url';
      const options = { keepAlive: true };
      // PacProxyAgent constructor doesn't validate URLs, so it won't throw
      expect(() => createPacAgent(pacUrl, options)).not.toThrow();
    });
  });

  describe('proxyAgentFor', () => {
    beforeEach(() => {
      // Clear proxy agent cache
      if (proxyAgentFor && proxyAgentFor.cache) {
        proxyAgentFor.cache.clear();
      }
    });

    it('should create and cache HTTP agent for http URLs', () => {
      const url = 'http://example.com';
      const options = {};

      const agent = proxyAgentFor(url, options);

      expect(agent).toBeInstanceOf(ProxyHttpAgent);
      expect(proxyAgentFor.cache.has('http://example.com')).toBe(true);
      expect(proxyAgentFor.cache.get('http://example.com')).toBe(agent);
    });

    it('should create and cache HTTPS agent for https URLs', () => {
      const url = 'https://example.com';
      const options = {};

      const agent = proxyAgentFor(url, options);

      expect(agent).toBeInstanceOf(ProxyHttpsAgent);
      expect(proxyAgentFor.cache.has('https://example.com')).toBe(true);
      expect(proxyAgentFor.cache.get('https://example.com')).toBe(agent);
    });

    it('should return cached agent when available', () => {
      const url = 'http://example.com';
      const options = {};

      const agent1 = proxyAgentFor(url, options);
      const agent2 = proxyAgentFor(url, options);

      expect(agent1).toBe(agent2);
      expect(proxyAgentFor.cache.size).toBe(1);
    });

    it('should cache agents by protocol and hostname', () => {
      const httpUrl = 'http://example.com/path1';
      const httpsUrl = 'https://example.com/path2';
      const httpUrl2 = 'http://example.com/different-path';

      const httpAgent = proxyAgentFor(httpUrl);
      const httpsAgent = proxyAgentFor(httpsUrl);
      const httpAgent2 = proxyAgentFor(httpUrl2);

      expect(httpAgent).toBe(httpAgent2); // same protocol+hostname should return same agent
      expect(httpAgent).not.toBe(httpsAgent); // different protocol should be different agent
      expect(proxyAgentFor.cache.size).toBe(2);
    });

    it('should pass options to agent constructor', () => {
      const url = 'https://example.com';
      const options = { maxSockets: 15 };

      const agent = proxyAgentFor(url, options);

      expect(agent).toBeInstanceOf(ProxyHttpsAgent);
      expect(agent.maxSockets).toBe(15);
    });

    it('should handle URL parsing correctly', () => {
      const url = 'https://sub.example.com:8443/api/test?param=value';

      const agent = proxyAgentFor(url);

      expect(agent).toBeInstanceOf(ProxyHttpsAgent);
      expect(proxyAgentFor.cache.has('https://sub.example.com')).toBe(true);
    });

    it('should handle errors gracefully and log error message', () => {
      const url = 'http://example.com'; // Use http to test ProxyHttpAgent

      // Spy on the main logger.log function to capture error messages
      const logSpy = spyOn(logger, 'log');

      // Clear the cache to ensure we create a new agent
      proxyAgentFor.cache.clear();

      // Mock the https.Agent constructor which is called inside ProxyHttpAgent
      // for the httpsAgent property. This will cause an error during ProxyHttpAgent creation.
      const originalHttpsAgent = https.Agent;
      https.Agent = function() {
        throw new Error('Test error during agent creation');
      };

      try {
        // This should trigger the catch block in proxyAgentFor when ProxyHttpAgent
        // tries to create its httpsAgent property
        expect(() => proxyAgentFor(url, {})).toThrow();

        // Verify that the error was logged with correct namespace and level
        expect(logSpy).toHaveBeenCalledWith('sdk-utils:proxy', 'error', 'Failed to create proxy agent: Test error during agent creation');
      } finally {
        // Restore the original constructor
        https.Agent = originalHttpsAgent;
      }
    });

    it('should create PAC agent when PERCY_PAC_FILE_URL is set', () => {
      process.env.PERCY_PAC_FILE_URL = 'http://example.com/proxy.pac';
      const logSpy = spyOn(logger, 'log');

      const agent = proxyAgentFor('http://example.com');

      expect(agent).toBeInstanceOf(PacProxyAgent);
      expect(logSpy).toHaveBeenCalledWith('sdk-utils:proxy', 'info', 'Using PAC file from: http://example.com/proxy.pac');
      expect(logSpy).toHaveBeenCalledWith('sdk-utils:proxy', 'info', 'Successfully loaded PAC file from: http://example.com/proxy.pac');
    });

    it('should have a cache property that is a Map', () => {
      expect(proxyAgentFor.cache).toBeInstanceOf(Map);
    });
  });
});
