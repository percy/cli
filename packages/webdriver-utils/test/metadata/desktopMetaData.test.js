import DesktopMetaData from '../../src/metadata/desktopMetaData.js';
import Driver from '../../src/driver.js';

describe('DesktopMetaData', () => {
  let getWindowSizeSpy;
  let executeScriptSpy;
  let desktopMetaData;

  beforeEach(() => {
    getWindowSizeSpy = spyOn(Driver.prototype, 'getWindowSize');
    executeScriptSpy = spyOn(Driver.prototype, 'executeScript');
    desktopMetaData = new DesktopMetaData(new Driver('123', 'http:executorUrl'), {
      browserName: 'Chrome',
      version: '111.0',
      platform: 'win'
    });
  });

  describe('browserName', () => {
    it('calculates browserName', () => {
      expect(desktopMetaData.browserName()).toEqual('chrome');
    });
  });

  describe('osName', () => {
    it('calculates osName', () => {
      expect(desktopMetaData.osName()).toEqual('win');
    });

    it('calculates alternate osName', () => {
      desktopMetaData = new DesktopMetaData(new Driver('123', 'http:executorUrl'), {
        browserName: 'Chrome',
        version: '111.0',
        osVersion: '10'
      });
      expect(desktopMetaData.osName()).toEqual('10');
    });
  });

  describe('osVersin', () => {
    it('calculates OsVersion', () => {
      expect(desktopMetaData.osVersion()).toEqual('111');
    });
  });

  describe('deviceName', () => {
    it('calculates deviceName', () => {
      expect(desktopMetaData.deviceName()).toEqual('chrome_111_win');
    });
  });

  describe('orientation', () => {
    it('calculates browserName', () => {
      expect(desktopMetaData.orientation()).toEqual('landscape');
    });
  });

  describe('windowSize', () => {
    let devicePixelRatioSpy;
    let windowSize;

    beforeEach(() => {
      devicePixelRatioSpy = spyOn(DesktopMetaData.prototype, 'devicePixelRatio').and.returnValue(Promise.resolve(2));
      getWindowSizeSpy.and.returnValue(Promise.resolve({ value: { width: 1000, height: 500 } }));
    });

    it('calculates windowSize', async () => {
      windowSize = await desktopMetaData.windowSize();
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
      devicePixelRatio = await desktopMetaData.devicePixelRatio();
      expect(devicePixelRatio).toEqual(2);
      expect(executeScriptSpy)
        .toHaveBeenCalledWith({ script: 'return window.devicePixelRatio;', args: [] });
    });
  });
});
