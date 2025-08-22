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
      browserVersion: '111.12.32',
      version: '111.0',
      platform: 'win',
      osVersion: '10'
    });
  });

  describe('browserName', () => {
    it('calculates browserName', () => {
      expect(desktopMetaData.browserName()).toEqual('chrome');
    });
  });

  describe('browserVersion', () => {
    it('calculates browserVersion', () => {
      expect(desktopMetaData.browserVersion()).toEqual('111');
    });
  });

  describe('osName', () => {
    it('calculates osName', () => {
      expect(desktopMetaData.osName()).toEqual('win');
    });

    it('calculates alternate osName', () => {
      desktopMetaData = new DesktopMetaData(new Driver('123', 'http:executorUrl'), {
        browserName: 'Chrome',
        browserVersion: '111.12.32',
        version: '111.0',
        os: 'win',
        osVersion: '10'
      });
      expect(desktopMetaData.osName()).toEqual('win');
    });
  });

  describe('osVersion', () => {
    it('calculates osVersion', () => {
      expect(desktopMetaData.osVersion()).toEqual('10');
    });
  });

  describe('deviceName', () => {
    it('calculates deviceName', () => {
      expect(desktopMetaData.deviceName()).toEqual('win_10_chrome_111');
    });
  });

  describe('orientation', () => {
    it('calculates orientation', () => {
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

  describe('screenResolution', () => {
    let screenInfo;

    beforeEach(() => {
      executeScriptSpy.and.returnValue(Promise.resolve({ value: ['1980', '1080'] }));
    });

    it('calculates the screen resolution', async () => {
      screenInfo = await desktopMetaData.screenResolution();
      expect(screenInfo).toEqual('1980 x 1080');
      expect(executeScriptSpy)
        .toHaveBeenCalledWith({ script: 'return [parseInt(window.screen.width * window.devicePixelRatio).toString(), parseInt(window.screen.height * window.devicePixelRatio).toString()];', args: [] });
    });
  });

  describe('device', () => {
    it('returns false', () => {
      expect(desktopMetaData.device()).toEqual(false);
    });
  });
});
