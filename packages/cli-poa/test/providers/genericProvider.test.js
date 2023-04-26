import GenericProvider from "../../src/providers/genericProvider.js";
import Driver from "../../src/driver.js";
import CommonMetaDataResolver from "../../src/metadata/commonMetaDataResolver.js";
import CommonDesktopMetaDataResolver from "../../src/metadata/commonDesktopMetaDataResolver.js";

describe('GenericProvider', () => {
  let genericProvider;
  let capabilitiesSpy;

  beforeEach(() => {
    capabilitiesSpy = spyOn(Driver.prototype, 'getCapabilites')
      .and.returnValue(Promise.resolve({browserName: 'Chrome'}));
  })

  describe('createDriver', () => {
    let commonMetaDataResolverSpy;
    let expectedDriver;

    beforeEach(() => {
      commonMetaDataResolverSpy = spyOn(CommonMetaDataResolver, 'resolve');
      expectedDriver = new Driver('123', 'http:executorUrl');
    })

    it('creates driver', async () => {
      genericProvider = new GenericProvider('123', 'http:executorUrl', {}, {});
      await genericProvider.createDriver();
      expect(genericProvider.driver).toEqual(expectedDriver);
      expect(capabilitiesSpy).toHaveBeenCalledTimes(1);
      expect(commonMetaDataResolverSpy).toHaveBeenCalledWith(expectedDriver, {browserName: 'Chrome'}, {});
    })

  })

  // not testing screenshot function as utils.postComparisons cannot be mocked
  // this is due to internal limitations of jasmine, where mocking functions from module is not possible
  // check - https://github.com/jasmine/jasmine/issues/1414
  describe('getTiles', () => {
    let takeScreenshotSpy;

    beforeEach(() => {
      takeScreenshotSpy = spyOn(Driver.prototype, 'takeScreenshot')
        .and.returnValue(Promise.resolve('123b='))
    })

    it('creates tiles from screenshot', async () => {
      genericProvider = new GenericProvider('123', 'http:executorUrl', {platform: 'win'}, {});
      genericProvider.createDriver();
      const tiles = await genericProvider.getTiles(false);
      expect(tiles.length).toEqual(1)
    })
  })

  describe('getTag', () => {
    let windowSizeSpy;
    let orientationSpy;
    let deviceNameSpy;
    let osNameSpy;
    let osVersionSpy;

    beforeEach(() => {
      windowSizeSpy = spyOn(CommonDesktopMetaDataResolver.prototype, 'windowSize')
        .and.returnValue(Promise.resolve({width: 1000, height: 1000}));
      orientationSpy = spyOn(CommonDesktopMetaDataResolver.prototype, 'orientation')
        .and.returnValue('landscape');
      deviceNameSpy = spyOn(CommonDesktopMetaDataResolver.prototype, 'deviceName')
        .and.returnValue('mockDeviceName');
      osNameSpy = spyOn(CommonDesktopMetaDataResolver.prototype, 'osName')
        .and.returnValue('mockOsName');
      osVersionSpy = spyOn(CommonDesktopMetaDataResolver.prototype, 'osVersion')
        .and.returnValue('mockOsVersion');
    })

    it('returns correct tag', async () => {
      genericProvider = new GenericProvider('123', 'http:executorUrl', {platform: 'win'}, {});
      await genericProvider.createDriver();
      const tag = await genericProvider.getTag();
      expect(tag).toEqual({
        name: 'mockDeviceName',
        osName: 'mockOsName',
        osVersion: 'mockOsVersion',
        width: 1000,
        height: 1000,
        orientation: 'landscape'
      })
    })
  })

  // describe('writeTempImage', () => {

  // })

  // describe('tempFile', () => {

  // })
})