import { ProxyHttpAgent, ProxyHttpsAgent, createPacAgent, getProxy, proxyAgentFor } from '../../src/proxy.js';
import { PacProxyAgent } from 'pac-proxy-agent';
import logger from '@percy/logger/test/helpers';

describe('proxy', () => {
  describe('getProxy', () => {
    beforeEach(async () => {
      process.env.http_proxy = 'http://proxy.com:8080';
    });

    it('should return proxy object if proxy is set', () => {
      const options = { protocol: 'http:', hostname: 'example.com' };
      const proxy = getProxy(options);
      expect(proxy).toBeInstanceOf(Object);
    });

    it('should return undefined if no proxy is set', () => {
      delete process.env.http_proxy;
      const options = { protocol: 'http:', hostname: 'example.com' };
      expect(getProxy(options)).toBeUndefined();
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
  });

  describe('proxyAgentFor', () => {
    beforeEach(async () => {
      await logger.mock({ level: 'debug' });
      proxyAgentFor.cache?.clear();
      process.env.PERCY_PAC_FILE_URL = 'http://example.com/proxy.pac';
    });

    afterEach(async () => {
      delete process.env.PERCY_PAC_FILE_URL;
    });

    it('should return cached agent if available', () => {
      delete process.env.PERCY_PAC_FILE_URL;
      const url = 'http://example.com';
      const options = {};
      const agent = new ProxyHttpAgent(options);
      proxyAgentFor.cache?.set('http://example.com', agent);
      expect(proxyAgentFor(url, options)).toBe(agent);
    });

    it('should create and cache new HTTP agent if not available', () => {
      delete process.env.PERCY_PAC_FILE_URL;
      const url = 'http://example.com';
      const options = {};
      const agent = proxyAgentFor(url, options);
      expect(agent).toBeInstanceOf(ProxyHttpAgent);
      expect(proxyAgentFor.cache.get('http://example.com')).toBe(agent);
    });

    it('should create and cache new HTTPS agent if not available', () => {
      delete process.env.PERCY_PAC_FILE_URL;
      const url = 'https://example.com';
      const options = {};
      const agent = proxyAgentFor(url, options);
      expect(agent).toBeInstanceOf(ProxyHttpsAgent);
      expect(proxyAgentFor.cache.get('https://example.com')).toBe(agent);
    });

    it('should create PAC proxy agent if PAC URL is provided', () => {
      const url = 'http://example.com';
      const options = {};
      const agent = proxyAgentFor(url, options);
      expect(agent).toBeInstanceOf(PacProxyAgent);
    });

    it('logs an error and throws when proxy agent creation fails', () => {
      const url = 'http://example.com';
      const options = {};
      process.env.PERCY_PAC_FILE_URL = 'invalid-url';
      expect(() => proxyAgentFor(url, options)).toThrowError('Failed to initialize PAC proxy: Invalid URL');
    });
  });
});
