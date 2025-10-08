import MobileMetaData from '../../src/metadata/mobileMetaData.js';
import Driver from '../../src/driver.js';
import Cache from '../../src/util/cache.js';

describe('MobileMetaData', () => {
  let getWindowSizeSpy;
  let executeScriptSpy;
  let mobileMetaData;

  beforeEach(() => {
    getWindowSizeSpy = spyOn(Driver.prototype, 'getWindowSize');
    executeScriptSpy = spyOn(Driver.prototype, 'executeScript');
    Cache.reset();
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

  describe('browserVersion', () => {
    it('calculates browserVersion', () => {
      expect(mobileMetaData.browserVersion()).toEqual('111');
    });

    it('calculates alternate browserVersion', () => {
      mobileMetaData = new MobileMetaData(new Driver('123', 'http:executorUrl'), {
        osVersion: '12.0',
        browserName: 'iphone',
        os: 'mac',
        browserVersion: '108.0',
        orientation: 'landscape',
        deviceName: 'SamsungS21-XYZ',
        platform: 'win'
      });
      expect(mobileMetaData.browserVersion()).toEqual('108');
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

  describe('osVersion', () => {
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

  describe('screenResolution', () => {
    let screenInfo;

    beforeEach(() => {
      executeScriptSpy.and.returnValue(Promise.resolve({ value: ['1980', '1080'] }));
    });

    it('calculates the screen resolution', async () => {
      screenInfo = await mobileMetaData.screenResolution();
      expect(screenInfo).toEqual('1980 x 1080');
      expect(executeScriptSpy)
        .toHaveBeenCalledWith({ script: 'return [parseInt(window.screen.width * window.devicePixelRatio).toString(), parseInt(window.screen.height * window.devicePixelRatio).toString()];', args: [] });
    });
  });

  describe('device', () => {
    it('returns false', () => {
      expect(mobileMetaData.device()).toEqual(true);
    });
  });
});
