import { normalizeBrowsers, visualConfigSnapshotDefaults } from '@percy/client/utils';

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

  describe('visualConfigSnapshotDefaults', () => {
    afterEach(() => { delete process.env.PERCY_VISUAL_CONFIG; });

    it('returns nothing when the env var is unset', () => {
      expect(visualConfigSnapshotDefaults()).toEqual({});
    });

    it('returns nothing for invalid JSON', () => {
      process.env.PERCY_VISUAL_CONFIG = '{bad';
      expect(visualConfigSnapshotDefaults()).toEqual({});
    });

    it('returns nothing for non-object JSON', () => {
      process.env.PERCY_VISUAL_CONFIG = '[1]';
      expect(visualConfigSnapshotDefaults()).toEqual({});
    });

    it('maps enableLayout and percyCssValue', () => {
      process.env.PERCY_VISUAL_CONFIG = JSON.stringify({
        enableLayout: false, percyCssValue: '.a{}'
      });
      expect(visualConfigSnapshotDefaults()).toEqual({ enableLayout: false, percyCSS: '.a{}' });
    });

    it('ignores wrongly typed or empty values', () => {
      process.env.PERCY_VISUAL_CONFIG = JSON.stringify({ enableLayout: 'yes', percyCssValue: ' \n' });
      expect(visualConfigSnapshotDefaults()).toEqual({});
    });
  });
});
