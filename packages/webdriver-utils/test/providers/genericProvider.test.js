import GenericProvider from '../../src/providers/genericProvider.js';
import Driver from '../../src/driver.js';
import MetaDataResolver from '../../src/metadata/metaDataResolver.js';
import DesktopMetaData from '../../src/metadata/desktopMetaData.js';

describe('GenericProvider', () => {
  let genericProvider;
  let capabilitiesSpy;

  beforeEach(() => {
    capabilitiesSpy = spyOn(Driver.prototype, 'getCapabilites')
      .and.returnValue(Promise.resolve({ browserName: 'Chrome' }));
  });

  describe('createDriver', () => {
    let metaDataResolverSpy;
    let expectedDriver;

    beforeEach(() => {
      metaDataResolverSpy = spyOn(MetaDataResolver, 'resolve');
      expectedDriver = new Driver('123', 'http:executorUrl');
    });

    it('creates driver', async () => {
      genericProvider = new GenericProvider('123', 'http:executorUrl', {}, {});
      await genericProvider.createDriver();
      expect(genericProvider.driver).toEqual(expectedDriver);
      expect(capabilitiesSpy).toHaveBeenCalledTimes(1);
      expect(metaDataResolverSpy).toHaveBeenCalledWith(expectedDriver, { browserName: 'Chrome' }, {});
    });
  });

  describe('getTiles', () => {
    beforeEach(() => {
      spyOn(Driver.prototype, 'takeScreenshot').and.returnValue(Promise.resolve('123b='));
    });

    it('creates tiles from screenshot', async () => {
      genericProvider = new GenericProvider('123', 'http:executorUrl', { platform: 'win' }, {});
      genericProvider.createDriver();
      const tiles = await genericProvider.getTiles(false);
      expect(tiles.length).toEqual(1);
    });

    it('throws error if driver not initailized', async () => {
      genericProvider = new GenericProvider('123', 'http:executorUrl', { platform: 'win' }, {});
      await expectAsync(genericProvider.getTiles(false)).toBeRejectedWithError('Driver is null, please initialize driver with createDriver().');
    });
  });

  describe('getTag', () => {
    beforeEach(() => {
      spyOn(DesktopMetaData.prototype, 'windowSize')
        .and.returnValue(Promise.resolve({ width: 1000, height: 1000 }));
      spyOn(DesktopMetaData.prototype, 'orientation')
        .and.returnValue('landscape');
      spyOn(DesktopMetaData.prototype, 'deviceName')
        .and.returnValue('mockDeviceName');
      spyOn(DesktopMetaData.prototype, 'osName')
        .and.returnValue('mockOsName');
      spyOn(DesktopMetaData.prototype, 'osVersion')
        .and.returnValue('mockOsVersion');
      spyOn(DesktopMetaData.prototype, 'browserName')
        .and.returnValue('mockBrowserName');
    });

    it('returns correct tag', async () => {
      genericProvider = new GenericProvider('123', 'http:executorUrl', { platform: 'win' }, {});
      await genericProvider.createDriver();
      const tag = await genericProvider.getTag();
      expect(tag).toEqual({
        name: 'mockDeviceName',
        osName: 'mockOsName',
        osVersion: 'mockOsVersion',
        width: 1000,
        height: 1000,
        orientation: 'landscape',
        browserName: 'mockBrowserName',
        browserVersion: 'unknown'
      });
    });

    it('throws error if driver not initailized', async () => {
      genericProvider = new GenericProvider('123', 'http:executorUrl', { platform: 'win' }, {});
      await expectAsync(genericProvider.getTag()).toBeRejectedWithError('Driver is null, please initialize driver with createDriver().');
    });
  });

  describe('screenshot', () => {
    let getTagSpy;
    let getTilesSpy;

    beforeEach(() => {
      getTagSpy = spyOn(GenericProvider.prototype, 'getTag').and.returnValue(Promise.resolve('mock-tag'));
      getTilesSpy = spyOn(GenericProvider.prototype, 'getTiles').and.returnValue(Promise.resolve('mock-tile'));
    });

    it('calls correct funcs', async () => {
      genericProvider = new GenericProvider('123', 'http:executorUrl', { platform: 'win' }, {});
      await genericProvider.createDriver();
      let res = await genericProvider.screenshot('mock-name');
      expect(getTagSpy).toHaveBeenCalledTimes(1);
      expect(getTilesSpy).toHaveBeenCalledOnceWith(false);
      expect(res).toEqual({
        name: 'mock-name',
        tag: 'mock-tag',
        tiles: 'mock-tile',
        externalDebugUrl: 'https://localhost/v1',
        environmentInfo: 'staging-poc-poa',
        clientInfo: 'local-poc-poa'
      });
    });
  });
});
