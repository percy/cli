import MetaDataResolver from '../../src/metadata/metaDataResolver.js';
import Driver from '../../src/driver.js';
import DesktopMetaData from '../../src/metadata/desktopMetaData.js';
import MobileMetaData from '../../src/metadata/mobileMetaData.js';

describe('MetaDataResolver', () => {
  describe('resolve', () => {
    let driver;
    let capabilities;
    let metadata;

    beforeEach(() => {
      driver = new Driver('123', 'http:executorUrl');
      capabilities = {};
    });

    it('throws error is driver is not sent', () => {
      expect(() => MetaDataResolver.resolve(null, capabilities, { platform: 'ios' }))
        .toThrowError('Please pass a Driver object');
    });

    it('resolves MobileMetaData correctly', () => {
      metadata = MetaDataResolver.resolve(driver, capabilities, { platform: 'ios' });
      expect(metadata).toBeInstanceOf(MobileMetaData);
      expect(metadata.driver).toEqual(driver);
      expect(metadata.capabilities).toEqual({});
    });

    it('resolves DesktopMetaData correctly', () => {
      metadata = MetaDataResolver.resolve(driver, capabilities, { platform: 'win' });
      expect(metadata).toBeInstanceOf(DesktopMetaData);
      expect(metadata.driver).toEqual(driver);
      expect(metadata.capabilities).toEqual({});
    });

    it('resolves MobileMetaData when deviceName is passed', () => {
      metadata = MetaDataResolver.resolve(driver, capabilities, { platform: 'Linux', deviceName: 'RX224' });
      expect(metadata).toBeInstanceOf(MobileMetaData);
      expect(metadata.driver).toEqual(driver);
      expect(metadata.capabilities).toEqual({});
    });

    it('resolves DesktopMetaData when no deviceName is passed', () => {
      metadata = MetaDataResolver.resolve(driver, capabilities, { platform: 'Linux' });
      expect(metadata).toBeInstanceOf(DesktopMetaData);
      expect(metadata.driver).toEqual(driver);
      expect(metadata.capabilities).toEqual({});
    });
  });
});
