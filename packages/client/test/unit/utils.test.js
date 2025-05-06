import { normalizeBrowsers } from '@percy/client/utils';

describe('utils', () => {
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
