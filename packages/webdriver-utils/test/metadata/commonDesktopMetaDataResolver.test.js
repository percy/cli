import CommonDesktopMetaDataResolver from '../../src/metadata/commonDesktopMetaDataResolver.js';
import Driver from '../../src/driver.js';

describe('CommonDesktopMetaDataResolver', () => {
  let getWindowSizeSpy;
  let executeScriptSpy;
  let CommonDesktopMetaData;

  beforeEach(() => {
    getWindowSizeSpy = spyOn(Driver.prototype, 'getWindowSize');
    executeScriptSpy = spyOn(Driver.prototype, 'executeScript');
    CommonDesktopMetaData = new CommonDesktopMetaDataResolver(new Driver('123', 'http:executorUrl'), {
      browserName: 'Chrome',
      version: '111.0',
      platform: 'win'
    });
  });

  describe('browserName', () => {
    it('calculates browserName', () => {
      expect(CommonDesktopMetaData.browserName()).toEqual('chrome');
    });
  });

  describe('osName', () => {
    it('calculates osName', () => {
      expect(CommonDesktopMetaData.osName()).toEqual('win');
    });

    it('calculates alternate osName', () => {
      CommonDesktopMetaData = new CommonDesktopMetaDataResolver(new Driver('123', 'http:executorUrl'), {
        browserName: 'Chrome',
        version: '111.0',
        osVersion: '10'
      });
      expect(CommonDesktopMetaData.osName()).toEqual('10');
    });
  });

  describe('osVersin', () => {
    it('calculates OsVersion', () => {
      expect(CommonDesktopMetaData.osVersion()).toEqual('111');
    });
  });

  describe('deviceName', () => {
    it('calculates deviceName', () => {
      expect(CommonDesktopMetaData.deviceName()).toEqual('chrome_111_win');
    });
  });

  describe('orientation', () => {
    it('calculates browserName', () => {
      expect(CommonDesktopMetaData.orientation()).toEqual('landscape');
    });
  });

  describe('windowSize', () => {
    let devicePixelRatioSpy;
    let windowSize;

    beforeEach(() => {
      devicePixelRatioSpy = spyOn(CommonDesktopMetaDataResolver.prototype, 'devicePixelRatio').and.returnValue(Promise.resolve(2));
      getWindowSizeSpy.and.returnValue(Promise.resolve({ value: { width: 1000, height: 500 } }));
    });

    it('calculates windowSize', async () => {
      windowSize = await CommonDesktopMetaData.windowSize();
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
      devicePixelRatio = await CommonDesktopMetaData.devicePixelRatio();
      expect(devicePixelRatio).toEqual(2);
      expect(executeScriptSpy)
        .toHaveBeenCalledWith({ script: 'return window.devicePixelRatio;', args: [] });
    });
  });
});
