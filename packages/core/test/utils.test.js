import { decodeAndEncodeURLWithLogging, waitForSelectorInsideBrowser, compareObjectTypes, isGzipped, checkSDKVersion, percyAutomateRequestHandler, detectFontMimeType, handleIncorrectFontMimeType, computeResponsiveWidths, appendUrlSearchParam, processCorsIframesInDomSnapshot, processCorsIframes } from '../src/utils.js';
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

  describe('computeResponsiveWidths', () => {
    it('returns widths with heights for mobile devices', () => {
      const userPassedWidths = [];
      const eligibleWidths = {
        mobile: [390, 428],
        config: [1280]
      };
      const deviceDetails = [
        { width: 390, height: 844 },
        { width: 428, height: 926 }
      ];

      const result = computeResponsiveWidths(userPassedWidths, eligibleWidths, deviceDetails);

      expect(result).toEqual([
        { width: 390, height: 844 },
        { width: 428, height: 926 },
        { width: 1280 }
      ]);
    });

    it('returns user-passed widths without heights', () => {
      const userPassedWidths = [375, 1920];
      const eligibleWidths = {
        mobile: [390],
        config: [1280]
      };
      const deviceDetails = [
        { width: 390, height: 844 }
      ];

      const result = computeResponsiveWidths(userPassedWidths, eligibleWidths, deviceDetails);

      expect(result).toEqual([
        { width: 375 },
        { width: 390, height: 844 },
        { width: 1920 }
      ]);
    });

    it('returns config widths when no user widths are passed', () => {
      const userPassedWidths = [];
      const eligibleWidths = {
        mobile: [390],
        config: [1280, 1920]
      };
      const deviceDetails = [
        { width: 390, height: 844 }
      ];

      const result = computeResponsiveWidths(userPassedWidths, eligibleWidths, deviceDetails);

      expect(result).toEqual([
        { width: 390, height: 844 },
        { width: 1280 },
        { width: 1920 }
      ]);
    });

    it('sorts widths in ascending order', () => {
      const userPassedWidths = [1920, 375];
      const eligibleWidths = {
        mobile: [428, 390],
        config: [1280]
      };
      const deviceDetails = [
        { width: 428, height: 926 },
        { width: 390, height: 844 }
      ];

      const result = computeResponsiveWidths(userPassedWidths, eligibleWidths, deviceDetails);

      expect(result).toEqual([
        { width: 375 },
        { width: 390, height: 844 },
        { width: 428, height: 926 },
        { width: 1920 }
      ]);
    });

    it('does not duplicate widths', () => {
      const userPassedWidths = [375, 1280];
      const eligibleWidths = {
        mobile: [375],
        config: [1280]
      };
      const deviceDetails = [
        { width: 375, height: 667 }
      ];

      const result = computeResponsiveWidths(userPassedWidths, eligibleWidths, deviceDetails);

      expect(result).toEqual([
        { width: 375, height: 667 },
        { width: 1280 }
      ]);
    });

    it('handles empty mobile widths array', () => {
      const userPassedWidths = [375, 1920];
      const eligibleWidths = {
        mobile: [],
        config: [1280]
      };
      const deviceDetails = [];

      const result = computeResponsiveWidths(userPassedWidths, eligibleWidths, deviceDetails);

      expect(result).toEqual([
        { width: 375 },
        { width: 1920 }
      ]);
    });

    it('handles devices without height property', () => {
      const userPassedWidths = [];
      const eligibleWidths = {
        mobile: [390, 428],
        config: [1280]
      };
      const deviceDetails = [
        { width: 390, height: 844 },
        { width: 428 } // no height
      ];

      const result = computeResponsiveWidths(userPassedWidths, eligibleWidths, deviceDetails);

      expect(result).toEqual([
        { width: 390, height: 844 },
        { width: 1280 }
      ]);
    });

    it('handles empty device details', () => {
      const userPassedWidths = [375];
      const eligibleWidths = {
        mobile: [],
        config: [1280]
      };
      const deviceDetails = [];

      const result = computeResponsiveWidths(userPassedWidths, eligibleWidths, deviceDetails);

      expect(result).toEqual([
        { width: 375 }
      ]);
    });

    it('returns only config widths when no user widths and no mobile devices', () => {
      const userPassedWidths = [];
      const eligibleWidths = {
        mobile: [],
        config: [375, 1280]
      };
      const deviceDetails = [];

      const result = computeResponsiveWidths(userPassedWidths, eligibleWidths, deviceDetails);

      expect(result).toEqual([
        { width: 375 },
        { width: 1280 }
      ]);
    });

    it('prioritizes mobile device height over user-passed width', () => {
      const userPassedWidths = [390]; // Same width as device
      const eligibleWidths = {
        mobile: [390],
        config: [1280]
      };
      const deviceDetails = [
        { width: 390, height: 844 }
      ];

      const result = computeResponsiveWidths(userPassedWidths, eligibleWidths, deviceDetails);

      // Should keep the device with height, not duplicate
      expect(result).toEqual([
        { width: 390, height: 844 }
      ]);
    });

    it('handles duplicate widths in mobile array', () => {
      const userPassedWidths = [];
      const eligibleWidths = {
        mobile: [390, 390, 428], // Duplicate 390
        config: [1280]
      };
      const deviceDetails = [
        { width: 390, height: 844 },
        { width: 428, height: 926 }
      ];

      const result = computeResponsiveWidths(userPassedWidths, eligibleWidths, deviceDetails);

      // Should not duplicate the 390 width
      expect(result).toEqual([
        { width: 390, height: 844 },
        { width: 428, height: 926 },
        { width: 1280 }
      ]);
    });

    it('handles mixed scenario with all width sources', () => {
      const userPassedWidths = [768, 1024];
      const eligibleWidths = {
        mobile: [390, 428],
        config: [1280, 1920]
      };
      const deviceDetails = [
        { width: 390, height: 844 },
        { width: 428, height: 926 }
      ];

      const result = computeResponsiveWidths(userPassedWidths, eligibleWidths, deviceDetails);

      expect(result).toEqual([
        { width: 390, height: 844 },
        { width: 428, height: 926 },
        { width: 768 },
        { width: 1024 }
      ]);
    });
  });

  describe('appendUrlSearchParam', () => {
    it('returns original URL when value is not provided (null)', () => {
      const url = 'https://example.com/page';
      const result = appendUrlSearchParam(url, 'percy_width', null);
      expect(result).toBe(url);
    });

    it('returns original URL when value is undefined', () => {
      const url = 'https://example.com/page';
      const result = appendUrlSearchParam(url, 'percy_width', undefined);
      expect(result).toBe(url);
    });

    it('returns original URL when value is empty string', () => {
      const url = 'https://example.com/page';
      const result = appendUrlSearchParam(url, 'percy_width', '');
      expect(result).toBe(url);
    });

    it('returns original URL when value is 0', () => {
      const url = 'https://example.com/page';
      const result = appendUrlSearchParam(url, 'percy_width', 0);
      expect(result).toBe(url);
    });

    it('successfully appends search parameter to URL without existing params', () => {
      const url = 'https://example.com/page';
      const result = appendUrlSearchParam(url, 'percy_width', 1280);
      expect(result).toBe('https://example.com/page?percy_width=1280');
    });

    it('successfully appends search parameter to URL with existing params', () => {
      const url = 'https://example.com/page?existing=param';
      const result = appendUrlSearchParam(url, 'percy_width', 1280);
      expect(result).toBe('https://example.com/page?existing=param&percy_width=1280');
    });

    it('successfully updates existing search parameter', () => {
      const url = 'https://example.com/page?percy_width=800';
      const result = appendUrlSearchParam(url, 'percy_width', 1280);
      expect(result).toBe('https://example.com/page?percy_width=1280');
    });

    it('converts numeric value to string', () => {
      const url = 'https://example.com/page';
      const result = appendUrlSearchParam(url, 'percy_width', 1280);
      expect(result).toContain('percy_width=1280');
    });

    it('handles invalid URL gracefully and returns original', () => {
      const invalidUrl = 'not-a-valid-url';
      const result = appendUrlSearchParam(invalidUrl, 'percy_width', 1280);
      expect(result).toBe(invalidUrl);
      expect(logger.stderr).toEqual(jasmine.arrayContaining([
        jasmine.stringMatching(/Failed to append search param to URL/)
      ]));
    });
  });

  describe('processCorsIframesInDomSnapshot', () => {
    it('returns domSnapshot unchanged when corsIframes is not present', () => {
      const domSnapshot = {
        html: '<html><body>test</body></html>',
        resources: []
      };
      const result = processCorsIframesInDomSnapshot(domSnapshot);
      expect(result).toEqual(domSnapshot);
      expect(result.corsIframes).toBeUndefined();
    });

    it('returns domSnapshot unchanged when corsIframes is empty array', () => {
      const domSnapshot = {
        html: '<html><body>test</body></html>',
        resources: [],
        corsIframes: []
      };
      const result = processCorsIframesInDomSnapshot(domSnapshot);
      expect(result).toEqual({
        html: '<html><body>test</body></html>',
        resources: []
      });
      expect(result.corsIframes).toBeUndefined();
    });

    it('initializes resources array if not present', () => {
      const domSnapshot = {
        html: '<html><body><iframe data-percy-element-id="frame1"></iframe></body></html>',
        width: 1280,
        corsIframes: [{
          frameUrl: 'https://example.com/iframe',
          iframeData: { percyElementId: 'frame1' },
          iframeResource: { url: '', content: 'data' },
          iframeSnapshot: null
        }]
      };
      const result = processCorsIframesInDomSnapshot(domSnapshot);
      expect(result.resources).toBeDefined();
      expect(Array.isArray(result.resources)).toBe(true);
    });

    it('processes single CORS iframe correctly with width parameter', () => {
      const domSnapshot = {
        html: '<html><body><iframe data-percy-element-id="frame1" src="old-url"></iframe></body></html>',
        width: 1280,
        resources: [],
        corsIframes: [{
          frameUrl: 'https://example.com/iframe',
          iframeData: { percyElementId: 'frame1' },
          iframeResource: { url: '', content: 'iframe-content' },
          iframeSnapshot: {
            resources: [
              { url: 'https://example.com/style.css', content: 'css' }
            ]
          }
        }]
      };

      const result = processCorsIframesInDomSnapshot(domSnapshot);

      // Check iframe resources were added
      expect(result.resources.length).toBe(2);
      expect(result.resources[0]).toEqual({ url: 'https://example.com/style.css', content: 'css' });
      expect(result.resources[1].url).toBe('https://example.com/iframe?percy_width=1280');
      expect(result.resources[1].content).toBe('iframe-content');

      // Check HTML was updated
      expect(result.html).toContain('src="https://example.com/iframe?percy_width=1280"');

      // Check corsIframes was removed
      expect(result.corsIframes).toBeUndefined();
    });

    it('processes CORS iframe without width parameter when width is not present', () => {
      const domSnapshot = {
        html: '<html><body><iframe data-percy-element-id="frame1"></iframe></body></html>',
        resources: [],
        corsIframes: [{
          frameUrl: 'https://example.com/iframe',
          iframeData: { percyElementId: 'frame1' },
          iframeResource: { url: '', content: 'iframe-content' },
          iframeSnapshot: null
        }]
      };

      const result = processCorsIframesInDomSnapshot(domSnapshot);

      expect(result.resources[0].url).toBe('https://example.com/iframe');
    });

    it('handles iframe without percyElementId (skips HTML src update)', () => {
      const domSnapshot = {
        html: '<html><body><iframe src="old-url"></iframe></body></html>',
        width: 1280,
        resources: [],
        corsIframes: [{
          frameUrl: 'https://example.com/iframe',
          iframeData: null,
          iframeResource: { url: '', content: 'iframe-content' },
          iframeSnapshot: null
        }]
      };

      const result = processCorsIframesInDomSnapshot(domSnapshot);

      // HTML should remain unchanged
      expect(result.html).toContain('src="old-url"');
      // But resource should be added
      expect(result.resources.length).toBe(1);
      expect(result.resources[0].url).toBe('https://example.com/iframe?percy_width=1280');
    });

    it('handles iframe without iframeSnapshot.resources', () => {
      const domSnapshot = {
        html: '<html><body><iframe data-percy-element-id="frame1"></iframe></body></html>',
        width: 1280,
        resources: [],
        corsIframes: [{
          frameUrl: 'https://example.com/iframe',
          iframeData: { percyElementId: 'frame1' },
          iframeResource: { url: '', content: 'iframe-content' },
          iframeSnapshot: null
        }]
      };

      const result = processCorsIframesInDomSnapshot(domSnapshot);

      expect(result.resources.length).toBe(1);
      expect(result.resources[0].url).toBe('https://example.com/iframe?percy_width=1280');
    });

    it('processes multiple CORS iframes correctly', () => {
      const domSnapshot = {
        html: '<html><body><iframe data-percy-element-id="frame1"></iframe><iframe data-percy-element-id="frame2"></iframe></body></html>',
        width: 1280,
        resources: [],
        corsIframes: [{
          frameUrl: 'https://example.com/iframe1',
          iframeData: { percyElementId: 'frame1' },
          iframeResource: { url: '', content: 'iframe1-content' },
          iframeSnapshot: {
            resources: [{ url: 'https://example.com/style1.css', content: 'css1' }]
          }
        }, {
          frameUrl: 'https://example.com/iframe2',
          iframeData: { percyElementId: 'frame2' },
          iframeResource: { url: '', content: 'iframe2-content' },
          iframeSnapshot: {
            resources: [{ url: 'https://example.com/style2.css', content: 'css2' }]
          }
        }]
      };

      const result = processCorsIframesInDomSnapshot(domSnapshot);

      expect(result.resources.length).toBe(4);
      expect(result.resources[0].url).toBe('https://example.com/style1.css');
      expect(result.resources[1].url).toBe('https://example.com/iframe1?percy_width=1280');
      expect(result.resources[2].url).toBe('https://example.com/style2.css');
      expect(result.resources[3].url).toBe('https://example.com/iframe2?percy_width=1280');
      expect(result.corsIframes).toBeUndefined();
    });

    it('appends to existing resources array', () => {
      const domSnapshot = {
        html: '<html><body><iframe data-percy-element-id="frame1"></iframe></body></html>',
        width: 1280,
        resources: [
          { url: 'https://example.com/existing.js', content: 'existing' }
        ],
        corsIframes: [{
          frameUrl: 'https://example.com/iframe',
          iframeData: { percyElementId: 'frame1' },
          iframeResource: { url: '', content: 'iframe-content' },
          iframeSnapshot: null
        }]
      };

      const result = processCorsIframesInDomSnapshot(domSnapshot);

      expect(result.resources.length).toBe(2);
      expect(result.resources[0].url).toBe('https://example.com/existing.js');
      expect(result.resources[1].url).toBe('https://example.com/iframe?percy_width=1280');
    });

    it('handles iframe with existing query parameters in frameUrl', () => {
      const domSnapshot = {
        html: '<html><body><iframe data-percy-element-id="frame1"></iframe></body></html>',
        width: 1280,
        resources: [],
        corsIframes: [{
          frameUrl: 'https://example.com/iframe?param=value',
          iframeData: { percyElementId: 'frame1' },
          iframeResource: { url: '', content: 'iframe-content' },
          iframeSnapshot: null
        }]
      };

      const result = processCorsIframesInDomSnapshot(domSnapshot);

      expect(result.resources[0].url).toBe('https://example.com/iframe?param=value&percy_width=1280');
    });
  });

  describe('processCorsIframes', () => {
    it('returns null when domSnapshot is null', () => {
      const result = processCorsIframes(null);
      expect(result).toBeNull();
    });

    it('returns undefined when domSnapshot is undefined', () => {
      const result = processCorsIframes(undefined);
      expect(result).toBeUndefined();
    });

    it('processes single domSnapshot object', () => {
      const domSnapshot = {
        html: '<html><body><iframe data-percy-element-id="frame1"></iframe></body></html>',
        width: 1280,
        corsIframes: [{
          frameUrl: 'https://example.com/iframe',
          iframeData: { percyElementId: 'frame1' },
          iframeResource: { url: '', content: 'iframe-content' },
          iframeSnapshot: null
        }]
      };

      const result = processCorsIframes(domSnapshot);

      expect(result.resources).toBeDefined();
      expect(result.resources.length).toBe(1);
      expect(result.corsIframes).toBeUndefined();
    });

    it('processes array of domSnapshots', () => {
      const domSnapshots = [{
        html: '<html><body><iframe data-percy-element-id="frame1"></iframe></body></html>',
        width: 1280,
        corsIframes: [{
          frameUrl: 'https://example.com/iframe1',
          iframeData: { percyElementId: 'frame1' },
          iframeResource: { url: '', content: 'iframe1-content' },
          iframeSnapshot: null
        }]
      }, {
        html: '<html><body><iframe data-percy-element-id="frame2"></iframe></body></html>',
        width: 1920,
        corsIframes: [{
          frameUrl: 'https://example.com/iframe2',
          iframeData: { percyElementId: 'frame2' },
          iframeResource: { url: '', content: 'iframe2-content' },
          iframeSnapshot: null
        }]
      }];

      const result = processCorsIframes(domSnapshots);

      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(2);
      expect(result[0].resources[0].url).toBe('https://example.com/iframe1?percy_width=1280');
      expect(result[1].resources[0].url).toBe('https://example.com/iframe2?percy_width=1920');
      expect(result[0].corsIframes).toBeUndefined();
      expect(result[1].corsIframes).toBeUndefined();
    });

    it('handles empty array', () => {
      const result = processCorsIframes([]);
      expect(result).toEqual([]);
    });

    it('processes array with mixed scenarios (some with corsIframes, some without)', () => {
      const domSnapshots = [{
        html: '<html><body><iframe data-percy-element-id="frame1"></iframe></body></html>',
        width: 1280,
        corsIframes: [{
          frameUrl: 'https://example.com/iframe',
          iframeData: { percyElementId: 'frame1' },
          iframeResource: { url: '', content: 'iframe-content' },
          iframeSnapshot: null
        }]
      }, {
        html: '<html><body>no iframes</body></html>',
        width: 1920
      }];

      const result = processCorsIframes(domSnapshots);

      expect(result.length).toBe(2);
      expect(result[0].resources).toBeDefined();
      expect(result[0].resources.length).toBe(1);
      expect(result[1].resources).toBeUndefined();
    });

    it('processes domSnapshot without corsIframes', () => {
      const domSnapshot = {
        html: '<html><body>test</body></html>',
        resources: []
      };

      const result = processCorsIframes(domSnapshot);

      expect(result).toEqual(domSnapshot);
    });
  });
});
