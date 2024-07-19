
import DetectProxy from '../../src/detect-proxy.js';
import logger from '@percy/logger/test/helpers';

const detectProxy = new DetectProxy();

describe('getSystemProxy', () => {
  let mockExecPromise;

  beforeAll(async () => {
    mockExecPromise = spyOn(detectProxy, 'execPromise');
    await logger.mock({ level: 'debug' });
  });

  describe('on macOS', () => {
    beforeAll(() => {
      detectProxy.platform = 'darwin';
    });

    it('should return proxies if they are enabled and present', async () => {
      const mockOutput = `
        HTTPEnable : 1
        HTTPProxy : proxy.example.com
        HTTPPort : 8080
        HTTPSEnable : 1
        HTTPSProxy : secureproxy.example.com
        HTTPSPort : 8443
      `;
      mockExecPromise.and.returnValue(Promise.resolve({ stdout: mockOutput }));

      const proxies = await detectProxy.getSystemProxy();
      expect(proxies).toEqual([
        { type: 'HTTP', host: 'proxy.example.com', port: 8080 },
        { type: 'HTTPS', host: 'secureproxy.example.com', port: 8443 }
      ]);
    });

    it('should return an empty array if proxies are not enabled', async () => {
      const mockOutput = `
        HTTPEnable : 0
        HTTPProxy : proxy.example.com
        HTTPPort : 8080
      `;
      mockExecPromise.and.returnValue(Promise.resolve({ stdout: mockOutput }));

      const proxies = await detectProxy.getSystemProxy();
      expect(proxies).toEqual([]);
    });

    it('should return an empty array empty response', async () => {
      const mockOutput = '';
      mockExecPromise.and.returnValue(Promise.resolve({ stdout: mockOutput }));

      const proxies = await detectProxy.getSystemProxy();
      expect(proxies).toEqual([]);
    });
  });

  describe('on Windows', () => {
    beforeAll(() => {
      detectProxy.platform = 'win32';
    });

    it('should return proxy if it is enabled and present', async () => {
      const mockOutput = `
        ProxyEnable    REG_DWORD    0x1
        ProxyServer    REG_SZ       proxy.example.com:8080
      `;
      mockExecPromise.and.returnValue(Promise.resolve({ stdout: mockOutput }));

      const proxy = await detectProxy.getSystemProxy();
      expect(proxy).toEqual({
        type: 'HTTP',
        host: 'proxy.example.com',
        port: 8080
      });
    });

    it('should return undefined if proxy is not enabled', async () => {
      const mockOutput = `
        HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings
        User Agent    REG_SZ    Mozilla/4.0 (compatible; MSIE 8.0; Win32)
        IE5_UA_Backup_Flag    REG_SZ    5.0
        ZonesSecurityUpgrade    REG_BINARY    ABCD
        EmailName    REG_SZ    User@
        AutoConfigProxy    REG_SZ    wininet.dll
        MimeExclusionListForCache    REG_SZ    multipart/mixed multipart/x-mixed-replace multipart/x-byteranges 
        WarnOnPost    REG_BINARY    01000000
        UseSchannelDirectly    REG_BINARY    01000000
        EnableHttp1_1    REG_DWORD    0x1
        UrlEncoding    REG_DWORD    0x0
        SecureProtocols    REG_DWORD    0xa0
        PrivacyAdvanced    REG_DWORD    0x0
        DisableCachingOfSSLPages    REG_DWORD    0x1
        WarnonZoneCrossing    REG_DWORD    0x1
        CertificateRevocation    REG_DWORD    0x1
        EnableNegotiate    REG_DWORD    0x1
        MigrateProxy    REG_DWORD    0x1
        ProxyEnable    REG_DWORD    0x0
      `;
      mockExecPromise.and.returnValue(Promise.resolve({ stdout: mockOutput }));

      const proxy = await detectProxy.getSystemProxy();
      expect(proxy).toBeUndefined();
    });
  });

  describe('on linux platforms', () => {
    beforeAll(() => {
      detectProxy.platform = 'linux';
    });

    it('should log a debug message and return undefined', async () => {
      const proxy = await detectProxy.getSystemProxy();
      expect(proxy).toBeUndefined();
      expect(logger.stderr).toEqual([]);
    });
  });

  describe('on unsupported platforms', () => {
    beforeAll(() => {
      detectProxy.platform = 'aix';
    });

    it('should log a debug message and return undefined', async () => {
      const proxy = await detectProxy.getSystemProxy();
      expect(proxy).toBeUndefined();
      expect(logger.stderr).toEqual([
        '[percy:client:detect-proxy] Not able to auto detect system proxy for aix platform'
      ]);
    });
  });
});
