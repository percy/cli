import { decodeAndEncodeURLWithLogging, waitForSelectorInsideBrowser, compareObjectTypes } from '../src/utils.js';
import { logger, setupTest } from './helpers/index.js';
import percyLogger from '@percy/logger';
import Percy from '@percy/core';

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
    });
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
});
