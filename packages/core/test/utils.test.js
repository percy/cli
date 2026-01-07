import { decodeAndEncodeURLWithLogging, waitForSelectorInsideBrowser, compareObjectTypes, isGzipped, checkSDKVersion, percyAutomateRequestHandler, detectFontMimeType, handleIncorrectFontMimeType } from '../src/utils.js';
import { logger, setupTest, mockRequests } from './helpers/index.js';
import percyLogger from '@percy/logger';
import Percy from '@percy/core';
import Pako from 'pako';

describe('utils', () => {
  let log;
  beforeEach(async () => {
    log = percyLogger();
    logger.reset(true);
    process.env.PERCY_FORCE_PKG_VALUE = JSON.stringify({ name: '@percy/client', version: '1.0.0' });
    jasmine.DEFAULT_TIMEOUT_INTERVAL = 150000;
    await logger.mock({ level: 'debug' });
  });

  describe('percyAutomateRequestHandler', () => {
    it('maps client/environment info, camelCases options, merges config, concatenates percyCSS and attaches buildInfo', () => {
      const req = {
        body: {
          client_info: 'sdk/1.0.0',
          environment_info: 'env/abc',
          options: {
            'percy-css': '.a{color:red}',
            freeze_animated_image: true,
            ignore_region_selectors: ['.ignore'],
            consider_region_xpaths: ['//div']
          }
        }
      };

      const percy = {
        build: { id: 'b1' },
        config: {
          percy: { platforms: [{ osName: 'Windows' }] },
          snapshot: {
            fullPage: false,
            percyCSS: '.root{display:none}',
            freezeAnimatedImage: false,
            freezeAnimation: true,
            freezeAnimatedImageOptions: {
              freezeImageBySelectors: ['.gif'],
              freezeImageByXpaths: ['//img']
            },
            ignoreRegions: { ignoreRegionSelectors: ['.global-ignore'], ignoreRegionXpaths: ['//global'] },
            considerRegions: { considerRegionSelectors: ['.global-consider'], considerRegionXpaths: ['//gconsider'] },
            regions: [{ top: 0, left: 0, bottom: 10, right: 10 }],
            algorithm: 'ssim',
            algorithmConfiguration: { sensitivity: 'high' },
            sync: true
          }
        }
      };

      percyAutomateRequestHandler(req, percy);

      // client/env mapping
      expect(req.body.clientInfo).toBe('sdk/1.0.0');
      expect(req.body.environmentInfo).toBe('env/abc');

      // options normalized and merged, percyCSS concatenated
      expect(req.body.options.version).toBe('v2');
      expect(req.body.options.platforms).toEqual(percy.config.percy.platforms);
      expect(req.body.options.fullPage).toBe(false);
      expect(req.body.options.percyCSS).toBe('.root{display:none}\n.a{color:red}');
      // freezeAnimatedImage comes from snapshot.freezeAnimatedImage || freezeAnimation (true)
      expect(req.body.options.freezeAnimatedImage).toBeTrue();
      expect(req.body.options.freezeImageBySelectors).toEqual(['.gif']);
      expect(req.body.options.freezeImageByXpaths).toEqual(['//img']);
      // arrays from request options should merge with global config where applicable
      expect(req.body.options.ignoreRegionSelectors).toEqual(['.global-ignore', '.ignore']);
      expect(req.body.options.ignoreRegionXpaths).toEqual(['//global']);
      expect(req.body.options.considerRegionSelectors).toEqual(['.global-consider']);
      expect(req.body.options.considerRegionXpaths).toEqual(['//gconsider', '//div']);
      expect(req.body.options.regions).toEqual([{ top: 0, left: 0, bottom: 10, right: 10 }]);
      expect(req.body.options.algorithm).toBe('ssim');
      expect(req.body.options.algorithmConfiguration).toEqual({ sensitivity: 'high' });
      expect(req.body.options.sync).toBeTrue();

      // build info attached
      expect(req.body.buildInfo).toEqual({ id: 'b1' });
    });

    it('handles missing client/environment and empty options', () => {
      const req = { body: { options: { } } };
      const percy = { build: { id: 'b' }, config: { percy: { platforms: [] }, snapshot: { percyCSS: '', freezeAnimation: false } } };

      percyAutomateRequestHandler(req, percy);

      expect(req.body.clientInfo).toBeUndefined();
      expect(req.body.environmentInfo).toBeUndefined();
      expect(req.body.options.version).toBe('v2');
      // When no global regions are defined, these should be undefined (not empty arrays)
      expect(req.body.options.platforms).toBeUndefined();
      expect(req.body.options.ignoreRegionSelectors).toBeUndefined();
      expect(req.body.options.ignoreRegionXpaths).toBeUndefined();
      expect(req.body.options.considerRegionSelectors).toBeUndefined();
      expect(req.body.options.considerRegionXpaths).toBeUndefined();
      expect(req.body.buildInfo).toEqual({ id: 'b' });
    });
  });

  describe('decodeAndEncodeURLWithLogging', () => {
    it('does not warn invalid url when options params is null', async () => {
      decodeAndEncodeURLWithLogging('https://abc.com/test%abc', log);
      expect(logger.stderr).toEqual([]);
    });

    it('does not warn invalid url when shouldLogWarning = false', async () => {
      decodeAndEncodeURLWithLogging('https://abc.com/test%abc', log,
        {
          shouldLogWarning: false
        });

      expect(logger.stderr).toEqual([]);
    });

    it('returns modified url', async () => {
      const url = decodeAndEncodeURLWithLogging('https://abc.com/test[ab]c', log,
        {
          shouldLogWarning: false
        });
      expect(logger.stderr).toEqual([]);
      expect(url).toEqual('https://abc.com/test%5Bab%5Dc');
    });

    it('warns if invalid url when shouldLogWarning = true', async () => {
      decodeAndEncodeURLWithLogging(
        'https://abc.com/test%abc',
        log,
        {
          shouldLogWarning: true,
          warningMessage: 'some Warning Message'
        });
      expect(logger.stderr).toEqual(['[percy] some Warning Message']);
    });
  });
  describe('waitForSelectorInsideBrowser', () => {
    it('waitForSelectorInsideBrowser should work when called with correct parameters', async () => {
      await setupTest();
      let percy = await Percy.start({
        token: 'PERCY_TOKEN',
        snapshot: { widths: [1000] },
        discovery: { concurrency: 1 }
      });
      const page = await percy.browser.page();
      spyOn(page, 'eval').and.callThrough();
      waitForSelectorInsideBrowser(page, 'body', 30000);

      expect(page.eval).toHaveBeenCalledWith('await waitForSelector("body", 30000)');
    }, 60000);
    it('should handle errors when waitForSelectorInsideBrowser fails', async () => {
      let error = null;
      const expectedError = new Error('Unable to find: body');

      try {
        await waitForSelectorInsideBrowser(null, 'body', 30000);
      } catch (e) {
        error = e;
      }

      expect(error).toEqual(expectedError);
    });
  });
  describe('compareObjectTypes', () => {
    describe('Primitive comparisons', () => {
      it('should return true for identical numbers', () => {
        expect(compareObjectTypes(42, 42)).toBe(true);
      });

      it('should return false for different numbers', () => {
        expect(compareObjectTypes(42, 43)).toBe(false);
      });

      it('should return true for identical strings', () => {
        expect(compareObjectTypes('hello', 'hello')).toBe(true);
      });

      it('should return false for different strings', () => {
        expect(compareObjectTypes('hello', 'world')).toBe(false);
      });

      it('should return true for null compared with null', () => {
        expect(compareObjectTypes(null, null)).toBe(true);
      });

      it('should return true for undefined compared with undefined', () => {
        expect(compareObjectTypes(undefined, undefined)).toBe(true);
      });

      it('should return false for null compared with an object', () => {
        expect(compareObjectTypes(null, { a: 1 })).toBe(false);
      });
    });

    describe('Shallow object comparisons', () => {
      it('should return true for identical shallow objects', () => {
        const obj1 = { a: 1, b: 2 };
        const obj2 = { a: 1, b: 2 };
        expect(compareObjectTypes(obj1, obj2)).toBe(true);
      });

      it('should return false for objects with different keys', () => {
        const obj1 = { a: 1, b: 2 };
        const obj2 = { a: 1, c: 2 };
        expect(compareObjectTypes(obj1, obj2)).toBe(false);
      });

      it('should return false for objects with different values', () => {
        const obj1 = { a: 1, b: 2 };
        const obj2 = { a: 1, b: 3 };
        expect(compareObjectTypes(obj1, obj2)).toBe(false);
      });
    });

    describe('Deep object comparisons', () => {
      it('should return true for deeply nested identical objects', () => {
        const obj1 = { a: { b: { c: 1 } } };
        const obj2 = { a: { b: { c: 1 } } };
        expect(compareObjectTypes(obj1, obj2)).toBe(true);
      });

      it('should return false for deeply nested objects with different values', () => {
        const obj1 = { a: { b: { c: 1 } } };
        const obj2 = { a: { b: { c: 2 } } };
        expect(compareObjectTypes(obj1, obj2)).toBe(false);
      });
    });

    describe('Array comparisons', () => {
      it('should return true for identical arrays', () => {
        const obj1 = [1, 2, 3];
        const obj2 = [1, 2, 3];
        expect(compareObjectTypes(obj1, obj2)).toBe(true);
      });

      it('should return false for arrays with different elements', () => {
        const obj1 = [1, 2, 3];
        const obj2 = [1, 2, 4];
        expect(compareObjectTypes(obj1, obj2)).toBe(false);
      });

      it('should handle mixed structures of arrays and objects', () => {
        const obj1 = { a: [1, { b: 2 }], c: 3 };
        const obj2 = { a: [1, { b: 2 }], c: 3 };
        expect(compareObjectTypes(obj1, obj2)).toBe(true);
      });
    });

    describe('Edge cases', () => {
      it('should return false for mismatched data types', () => {
        const obj1 = { a: 1 };
        const obj2 = 'string';
        expect(compareObjectTypes(obj1, obj2)).toBe(false);
      });

      it('should return true for empty objects', () => {
        const obj1 = {};
        const obj2 = {};
        expect(compareObjectTypes(obj1, obj2)).toBe(true);
      });

      it('should return false for objects with different key lengths', () => {
        const obj1 = { a: 1 };
        const obj2 = { a: 1, b: 2 };
        expect(compareObjectTypes(obj1, obj2)).toBe(false);
      });
    });
  });
  describe('isGzipped', () => {
    it('returns true for gzipped content', () => {
      const compressed = Pako.gzip('Hello, world!');
      expect(isGzipped(compressed)).toBe(true);
    });

    it('returns false for plain uncompressed content', () => {
      const uncompressed = new TextEncoder().encode('Hello, world!');
      expect(isGzipped(uncompressed)).toBe(false);
    });

    it('returns false for a plain string input', () => {
      const invalidInput = 'Not a Uint8Array';
      expect(isGzipped(invalidInput)).toBe(false);
    });

    it('returns false for an empty Uint8Array', () => {
      const emptyArray = new Uint8Array([]);
      expect(isGzipped(emptyArray)).toBe(false);
    });

    it('returns false for an undefined', () => {
      const empty = undefined;
      expect(isGzipped(empty)).toBe(false);
    });

    it('returns false for an ArrayBuffer without Gzip magic number', () => {
      const buffer = new ArrayBuffer(10);
      const view = new Uint8Array(buffer);
      view[0] = 0x00;
      view[1] = 0x01;
      expect(isGzipped(buffer)).toBe(false);
    });

    it('returns true for an ArrayBuffer with Gzip magic number', () => {
      const buffer = new ArrayBuffer(10);
      const view = new Uint8Array(buffer);
      view[0] = 0x1f; // Gzip magic number
      view[1] = 0x8b; // Gzip magic number
      expect(isGzipped(buffer)).toBe(true);
    });
  });

  describe('checkSDKVersion', () => {
    let ghAPI;

    beforeEach(async () => {
      ghAPI = await mockRequests('https://api.github.com');
    });

    it('handles invalid clientInfo format', async () => {
      await checkSDKVersion('invalid-format');
      expect(logger.stderr).toContain('[percy:core:sdk-version] Invalid clientInfo format: invalid-format');
    });

    it('handles missing repo mapping', async () => {
      await checkSDKVersion('unknown-package/1.0.0');
      expect(logger.stderr).toContain('[percy:core:sdk-version] No repo mapping found for package: unknown-package');
    });

    it('detects when update is available', async () => {
      ghAPI.and.returnValue([200, [{ tag_name: 'v2.3.0', prerelease: false }]]);
      await checkSDKVersion('@percy/selenium-webdriver/2.2.0');
      expect(logger.stderr).toContain('[percy:core:sdk-version] [SDK Update Available] @percy/selenium-webdriver: 2.2.0 -> 2.3.0');
    });

    it('handles when no update needed', async () => {
      ghAPI.and.returnValue([200, [{ tag_name: 'v2.2.0', prerelease: false }]]);
      await checkSDKVersion('@percy/selenium-webdriver/2.2.0');
      expect(logger.stderr).not.toContain('[SDK Update Available]');
      expect(logger.stderr).toContain('[percy:core:sdk-version] [SDK Version Check] Current: 2.2.0, Latest: 2.2.0');
    });

    it('skips prerelease versions', async () => {
      ghAPI.and.returnValue([200, [
        { tag_name: 'v3.0.0-beta.1', prerelease: true },
        { tag_name: 'v2.3.0', prerelease: false }
      ]]);
      await checkSDKVersion('@percy/selenium-webdriver/2.2.0');
      expect(logger.stderr).toContain('[percy:core:sdk-version] [SDK Update Available] @percy/selenium-webdriver: 2.2.0 -> 2.3.0');
    });

    it('handles request errors gracefully', async () => {
      ghAPI.and.returnValue([500, 'Internal Server Error']);
      await checkSDKVersion('@percy/selenium-webdriver/2.2.0');
      expect(logger.stderr).toContain('[percy:core:sdk-version] Could not check SDK version');
    });

    it('handles empty releases array from GitHub API', async () => {
      ghAPI.and.returnValue([200, []]);
      await checkSDKVersion('@percy/selenium-webdriver/2.2.0');
      expect(logger.stderr).toEqual([]);
    });

    it('handles releases missing tag_name gracefully', async () => {
      ghAPI.and.returnValue([200, [
        { prerelease: false }, // missing tag_name
        { tag_name: 'v2.3.0', prerelease: true }
      ]]);
      await checkSDKVersion('@percy/selenium-webdriver/2.2.0');
      // Should not log an update or version check, but may log an error
      expect(logger.stderr).toContain('[percy:core:sdk-version] Could not check SDK version');
    });
  });

  describe('detectFontMimeType', () => {
    it('should detect WOFF font format', () => {
      const woffBuffer = Buffer.from('wOFF\x00\x01\x00\x00', 'binary');
      expect(detectFontMimeType(woffBuffer)).toEqual('font/woff');
    });

    it('should detect WOFF2 font format', () => {
      const woff2Buffer = Buffer.from('wOF2\x00\x01\x00\x00', 'binary');
      expect(detectFontMimeType(woff2Buffer)).toEqual('font/woff2');
    });

    it('should detect TTF font format', () => {
      const ttfBuffer = Buffer.from([0x00, 0x01, 0x00, 0x00, 0x00, 0x00]);
      expect(detectFontMimeType(ttfBuffer)).toEqual('font/ttf');
    });

    it('should detect OTF font format', () => {
      const otfBuffer = Buffer.from('OTTO\x00\x01\x00\x00', 'binary');
      expect(detectFontMimeType(otfBuffer)).toEqual('font/otf');
    });

    it('should return null for non-font buffer', () => {
      const nonFontBuffer = Buffer.from('This is not a font file', 'utf-8');
      expect(detectFontMimeType(nonFontBuffer)).toBeNull();
    });

    it('should return null for buffer with less than 4 bytes', () => {
      const shortBuffer = Buffer.from([0x00, 0x01]);
      expect(detectFontMimeType(shortBuffer)).toBeNull();
    });

    it('should return null for empty buffer', () => {
      const emptyBuffer = Buffer.from([]);
      expect(detectFontMimeType(emptyBuffer)).toBeNull();
    });

    it('should return null for null input', () => {
      expect(detectFontMimeType(null)).toBeNull();
    });

    it('should return null for undefined input', () => {
      expect(detectFontMimeType(undefined)).toBeNull();
    });

    it('should handle errors gracefully and return null', () => {
      // Create a malformed buffer-like object that will cause an error
      const malformedBuffer = { slice: () => { throw new Error('Test error'); } };
      expect(detectFontMimeType(malformedBuffer)).toBeNull();
    });
  });

  describe('handleIncorrectFontMimeType', () => {
    let mockMeta;

    beforeEach(() => {
      mockMeta = { url: 'http://fonts.gstatic.com/s/roboto/font' };
    });

    it('should detect WOFF2 format from Google Fonts with text/html mime type', () => {
      const woff2Buffer = Buffer.from([0x77, 0x4F, 0x46, 0x32, 0x00, 0x01, 0x00, 0x00]);
      const urlObj = new URL('http://fonts.gstatic.com/s/roboto/v30/font.woff2');

      const result = handleIncorrectFontMimeType(urlObj, 'text/html', woff2Buffer, [], mockMeta);

      expect(result).toBe('font/woff2');
      expect(logger.stderr).toContain('[percy:core:utils] - Detected Google Font as font/woff2 from content, overriding mime type');
    });

    it('should detect WOFF format from Google Fonts with text/html mime type', () => {
      const woffBuffer = Buffer.from([0x77, 0x4F, 0x46, 0x46, 0x00, 0x01, 0x00, 0x00]);
      const urlObj = new URL('http://fonts.gstatic.com/s/roboto/v30/font.woff');

      const result = handleIncorrectFontMimeType(urlObj, 'text/html', woffBuffer, [], mockMeta);

      expect(result).toBe('font/woff');
      expect(logger.stderr).toContain('[percy:core:utils] - Detected Google Font as font/woff from content, overriding mime type');
    });

    it('should fallback to application/font-woff2 when format cannot be detected', () => {
      const unknownBuffer = Buffer.from([0xFF, 0xFE, 0x00, 0x00]);
      const urlObj = new URL('http://fonts.gstatic.com/s/roboto/v30/font');

      const result = handleIncorrectFontMimeType(urlObj, 'text/html', unknownBuffer, [], mockMeta);

      expect(result).toBe('application/font-woff2');
      expect(logger.stderr).toContain('[percy:core:utils] - Google Font detected but format unclear, treating as font');
    });

    it('should not override mime type for non-Google Fonts URLs', () => {
      const woff2Buffer = Buffer.from([0x77, 0x4F, 0x46, 0x32, 0x00, 0x01, 0x00, 0x00]);
      const urlObj = new URL('http://my-cdn.com/fonts/roboto.woff2');

      const result = handleIncorrectFontMimeType(urlObj, 'text/html', woff2Buffer, [], mockMeta);

      expect(result).toBe('text/html');
      expect(logger.stderr).toEqual([]);
    });

    it('should not override mime type for Google Fonts with non-text/html response', () => {
      const woff2Buffer = Buffer.from([0x77, 0x4F, 0x46, 0x32, 0x00, 0x01, 0x00, 0x00]);
      const urlObj = new URL('http://fonts.gstatic.com/s/roboto/v30/font.woff2');

      const result = handleIncorrectFontMimeType(urlObj, 'font/woff2', woff2Buffer, [], mockMeta);

      expect(result).toBe('font/woff2');
      expect(logger.stderr).toEqual([]);
    });

    it('should handle empty buffer gracefully', () => {
      const emptyBuffer = Buffer.from([]);
      const urlObj = new URL('http://fonts.gstatic.com/s/roboto/v30/font');

      const result = handleIncorrectFontMimeType(urlObj, 'text/html', emptyBuffer, [], mockMeta);

      expect(result).toBe('application/font-woff2');
      expect(logger.stderr).toContain('[percy:core:utils] - Google Font detected but format unclear, treating as font');
    });

    it('should detect custom configured font domains and override mime type', () => {
      const woff2Buffer = Buffer.from([0x77, 0x4F, 0x46, 0x32, 0x00, 0x01, 0x00, 0x00]);
      const urlObj = new URL('http://custom-fonts.example.com/roboto.woff2');
      const userDomains = ['custom-fonts.example.com'];

      const result = handleIncorrectFontMimeType(urlObj, 'text/html', woff2Buffer, userDomains, mockMeta);

      expect(result).toBe('font/woff2');
      expect(logger.stderr).toContain('[percy:core:utils] - Detected Google Font as font/woff2 from content, overriding mime type');
    });

    it('should not override mime type for custom domains not in the list', () => {
      const woff2Buffer = Buffer.from([0x77, 0x4F, 0x46, 0x32, 0x00, 0x01, 0x00, 0x00]);
      const urlObj = new URL('http://other-cdn.example.com/roboto.woff2');
      const userDomains = ['custom-fonts.example.com'];

      const result = handleIncorrectFontMimeType(urlObj, 'text/html', woff2Buffer, userDomains, mockMeta);

      expect(result).toBe('text/html');
      expect(logger.stderr).toEqual([]);
    });

    it('should detect Google Fonts with default userConfiguredFontDomains', () => {
      const woff2Buffer = Buffer.from([0x77, 0x4F, 0x46, 0x32, 0x00, 0x01, 0x00, 0x00]);
      const urlObj = new URL('http://fonts.gstatic.com/s/roboto/v30/font.woff2');

      // Call without userConfiguredFontDomains parameter to use default
      const result = handleIncorrectFontMimeType(urlObj, 'text/html', woff2Buffer, undefined, mockMeta);

      expect(result).toBe('font/woff2');
      expect(logger.stderr).toContain('[percy:core:utils] - Detected Google Font as font/woff2 from content, overriding mime type');
    });
  });

  describe('logAssetInstrumentation', () => {
    let logAssetInstrumentation;

    beforeEach(async () => {
      await setupTest();
      // Import after setupTest to ensure logger is mocked
      ({ logAssetInstrumentation } = await import('../src/utils.js'));
    });

    it('logs asset instrumentation with correct format', () => {
      logAssetInstrumentation('asset_load_5xx', {
        url: 'http://example.com/api/data',
        reason: 'server_error',
        statusCode: 502,
        snapshot: 'Home Page'
      });

      // Verify the log was stored with CI debug namespace
      // Note: 'ci' logs are excluded from stdout but stored in memory
      const logs = logger.instance.query(log => log.debug === 'ci');
      expect(logs.length).toBe(1);
      expect(logs[0].message).toContain('ASSET_INSTRUMENTATION|asset_load_5xx|');
      expect(logs[0].meta.instrumentationCategory).toBe('asset_load_5xx');
      expect(logs[0].meta.url).toBe('http://example.com/api/data');
      expect(logs[0].meta.statusCode).toBe(502);
    });

    it('logs asset_load_missing category', () => {
      logAssetInstrumentation('asset_load_missing', {
        url: 'http://example.com/missing.jpg',
        reason: 'no_response',
        snapshot: 'Product Page',
        requestType: 'Image'
      });

      const logs = logger.instance.query(log => log.debug === 'ci');
      expect(logs.length).toBe(1);
      expect(logs[0].meta.instrumentationCategory).toBe('asset_load_missing');
      expect(logs[0].meta.reason).toBe('no_response');
    });

    it('logs asset_not_uploaded category with various reasons', () => {
      logAssetInstrumentation('asset_not_uploaded', {
        url: 'http://example.com/large.css',
        reason: 'resource_too_large',
        size: 30000000,
        snapshot: 'Home Page'
      });

      const logs = logger.instance.query(log => log.debug === 'ci');
      expect(logs.length).toBe(1);
      expect(logs[0].meta.instrumentationCategory).toBe('asset_not_uploaded');
      expect(logs[0].meta.reason).toBe('resource_too_large');
      expect(logs[0].meta.size).toBe(30000000);
    });

    it('includes all data fields in meta', () => {
      const testData = {
        url: 'http://example.com/test.js',
        reason: 'disallowed_hostname',
        hostname: 'example.com',
        snapshot: 'Test Snapshot',
        customField: 'custom value'
      };

      logAssetInstrumentation('asset_not_uploaded', testData);

      const logs = logger.instance.query(log => log.debug === 'ci');
      expect(logs.length).toBe(1);

      // All fields should be in meta
      Object.keys(testData).forEach(key => {
        expect(logs[0].meta[key]).toBe(testData[key]);
      });
    });

    it('formats message with pipe-separated values for API parsing', () => {
      logAssetInstrumentation('asset_load_5xx', {
        url: 'http://example.com/api',
        statusCode: 503
      });

      const logs = logger.instance.query(log => log.debug === 'ci');
      const message = logs[0].message;

      // Message should follow format: ASSET_INSTRUMENTATION|category|json
      const parts = message.split('|');
      expect(parts[0]).toBe('ASSET_INSTRUMENTATION');
      expect(parts[1]).toBe('asset_load_5xx');

      // Third part should be valid JSON
      const jsonData = JSON.parse(parts.slice(2).join('|'));
      expect(jsonData.url).toBe('http://example.com/api');
      expect(jsonData.statusCode).toBe(503);
    });
  });
});
