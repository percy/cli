import MobileMetaData from '../../src/metadata/mobileMetaData.js';
import Driver from '../../src/driver.js';

describe('MobileMetaData', () => {
  let getWindowSizeSpy;
  let executeScriptSpy;
  let mobileMetaData;

  beforeEach(() => {
    getWindowSizeSpy = spyOn(Driver.prototype, 'getWindowSize');
    executeScriptSpy = spyOn(Driver.prototype, 'executeScript');
    mobileMetaData = new MobileMetaData(new Driver('123', 'http:executorUrl'), {
      osVersion: '12.0',
      browserName: 'Chrome',
      os: 'android',
      version: '111.0',
      orientation: 'landscape',
      deviceName: 'SamsungS21-XYZ',
      platform: 'win'
    });
  });

  describe('browserName', () => {
    it('calculates browserName', () => {
      expect(mobileMetaData.browserName()).toEqual('chrome');
    });
  });

  describe('osName', () => {
    it('calculates osName', () => {
      expect(mobileMetaData.osName()).toEqual('android');
    });

    it('calculates alternate osName', () => {
      mobileMetaData = new MobileMetaData(new Driver('123', 'http:executorUrl'), {
        osVersion: '12.0',
        browserName: 'iphone',
        os: 'mac',
        version: '111.0',
        orientation: 'landscape',
        deviceName: 'SamsungS21-XYZ',
        platform: 'win'
      });
      expect(mobileMetaData.osName()).toEqual('ios');
    });
  });

  describe('osVersin', () => {
    it('calculates OsVersion', () => {
      expect(mobileMetaData.osVersion()).toEqual('12');
    });
  });

  describe('deviceName', () => {
    it('calculates deviceName', () => {
      expect(mobileMetaData.deviceName()).toEqual('SamsungS21');
    });
  });

  describe('orientation', () => {
    it('calculates browserName', () => {
      expect(mobileMetaData.orientation()).toEqual('landscape');
    });
  });

  describe('windowSize', () => {
    let devicePixelRatioSpy;
    let windowSize;

    beforeEach(() => {
      devicePixelRatioSpy = spyOn(MobileMetaData.prototype, 'devicePixelRatio').and.returnValue(Promise.resolve(2));
      getWindowSizeSpy.and.returnValue(Promise.resolve({ value: { width: 1000, height: 500 } }));
    });

    it('calculates windowSize', async () => {
      windowSize = await mobileMetaData.windowSize();
      expect(devicePixelRatioSpy).toHaveBeenCalledTimes(1);
      expect(getWindowSizeSpy).toHaveBeenCalledTimes(1);
      expect(windowSize).toEqual({ width: 2000, height: 1000 });
    });
  });

  describe('devicePixelRatio', () => {
    let devicePixelRatio;

    beforeEach(() => {
      executeScriptSpy.and.returnValue(Promise.resolve({ value: 2 }));
    });

    it('calculates devicePixelRatio', async () => {
      devicePixelRatio = await mobileMetaData.devicePixelRatio();
      expect(devicePixelRatio).toEqual(2);
      expect(executeScriptSpy)
        .toHaveBeenCalledWith({ script: 'return window.devicePixelRatio;', args: [] });
    });
  });
});
