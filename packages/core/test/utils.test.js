import { decodeAndEncodeURLWithLogging } from '../src/utils.js';
import { logger } from './helpers/index.js';
import percyLogger from '@percy/logger';

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
});
