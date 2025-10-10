import { decodeAndEncodeURLWithLogging, waitForSelectorInsideBrowser, compareObjectTypes, isGzipped, checkSDKVersion } from '../src/utils.js';
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
    await logger.mock({ level: 'debug' });
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
});
