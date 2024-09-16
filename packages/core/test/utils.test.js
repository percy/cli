import { decodeAndEncodeURLWithLogging, waitForSelectorInsideBrowser } from '../src/utils.js';
import { logger, setupTest } from './helpers/index.js';
import percyLogger from '@percy/logger';
import Percy from '@percy/core';

describe('utils', () => {
  let log;
  beforeEach(async () => {
    log = percyLogger();
    logger.reset(true);
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
});
