import CommonMetaDataResolver from "../../src/metadata/commonMetaDataResolver.js";
import Driver from "../../src/driver.js"
import CommonDesktopMetaDataResolver from "../../src/metadata/commonDesktopMetaDataResolver.js";
import CommonMobileMetaDataResolver from "../../src/metadata/commonMobileMetaDetaResolver.js";

describe('CommonMetaDataResolver', () => {
  describe('resolve', () => {
    let driver;
    let capabilities;
    let metadata;
    
    beforeEach(() => {
      driver = new Driver('123', 'http:executorUrl');
      capabilities = {};
    })

    it('throws error is driver is not sent', () => {
      expect(() => CommonMetaDataResolver.resolve(null, capabilities, {platform: 'ios'}))
        .toThrowError('Please pass a Driver object');
    })
    
    it('resolves CommonMobileMetaData correctly', () => {
      metadata = CommonMetaDataResolver.resolve(driver, capabilities, {platform: 'ios'});
      expect(metadata).toBeInstanceOf(CommonMobileMetaDataResolver);
      expect(metadata.driver).toEqual(driver);
      expect(metadata.capabilities).toEqual({});
    })

    it('resolves CommonDesktopMetaData correctly', () => {
      metadata = CommonMetaDataResolver.resolve(driver, capabilities, {platform: 'win'});
      expect(metadata).toBeInstanceOf(CommonDesktopMetaDataResolver);
      expect(metadata.driver).toEqual(driver);
      expect(metadata.capabilities).toEqual({});
    })
  })
})