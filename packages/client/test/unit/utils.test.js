import { md5base64, normalizeBrowsers, sha256hash } from '@percy/client/utils';
import crypto from 'crypto';

describe('utils', () => {
  describe('md5base64', () => {
    it('returns the base64-encoded MD5 of a string', () => {
      // RFC 1864 test vector: empty string MD5 base64
      expect(md5base64('')).toEqual('1B2M2Y8AsgTpgAmY7PhCfg==');
    });

    it('returns the base64-encoded MD5 of a buffer', () => {
      const buf = Buffer.from('hello world', 'utf-8');
      const expected = crypto.createHash('md5').update(buf).digest('base64');
      expect(md5base64(buf)).toEqual(expected);
    });

    it('treats strings as UTF-8 (same encoding as sha256hash)', () => {
      const utf8 = 'café — résumé';
      const expectedMd5 = crypto.createHash('md5').update(utf8, 'utf-8').digest('base64');
      const expectedSha = crypto.createHash('sha256').update(utf8, 'utf-8').digest('hex');
      expect(md5base64(utf8)).toEqual(expectedMd5);
      expect(sha256hash(utf8)).toEqual(expectedSha);
    });
  });

  describe('normalizeBrowsers', () => {
    describe('when browser values are in kebabcase', () => {
      it('returns snakecase values', () => {
        const browserValues = ['chrome', 'firefox', 'chrome-on-android'];
        const expected = [
          'chrome',
          'firefox',
          'chrome_on_android'
        ];
        expect(normalizeBrowsers(browserValues)).toEqual(expected);
      });
    });

    describe('when browser values are in camelcase', () => {
      it('returns snakecase values', () => {
        const browserValues = ['Chrome', 'Firefox', 'ChromeOnAndroid'];
        const expected = [
          'chrome',
          'firefox',
          'chrome_on_android'
        ];
        expect(normalizeBrowsers(browserValues)).toEqual(expected);
      });
    });

    describe('when browser values are in snakecase', () => {
      it('returns snakecase values', () => {
        const browserValues = ['chrome', 'firefox', 'chrome_on_android'];
        const expected = [
          'chrome',
          'firefox',
          'chrome_on_android'
        ];
        expect(normalizeBrowsers(browserValues)).toEqual(expected);
      });
    });

    describe('when browser values are in mixed case', () => {
      it('returns snakecase values', () => {
        const browserValues = ['Chrome', 'firefox', 'ChromeOnAndroid', 'safari-on-iphone'];
        const expected = [
          'chrome',
          'firefox',
          'chrome_on_android',
          'safari_on_iphone'
        ];
        expect(normalizeBrowsers(browserValues)).toEqual(expected);
      });
    });
  });
});
