import GenericProvider from '../../src/providers/genericProvider.js';
import Driver from '../../src/driver.js';
import MetaDataResolver from '../../src/metadata/metaDataResolver.js';
import DesktopMetaData from '../../src/metadata/desktopMetaData.js';
import MobileMetaData from '../../src/metadata/mobileMetaData.js';

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
      expectedDriver = new Driver('123', 'http:executorUrl', {});
    });

    it('creates driver', async () => {
      genericProvider = new GenericProvider('123', 'http:executorUrl', {});
      await genericProvider.createDriver();
      expect(genericProvider.driver).toEqual(expectedDriver);
      expect(capabilitiesSpy).toHaveBeenCalledTimes(1);
      expect(metaDataResolverSpy).toHaveBeenCalledWith(expectedDriver, { browserName: 'Chrome' }, {});
    });
  });

  describe('getTiles', () => {
    beforeEach(() => {
      spyOn(Driver.prototype, 'takeScreenshot').and.returnValue(Promise.resolve('123b='));
      spyOn(GenericProvider.prototype, 'getWindowHeight').and.returnValue(Promise.resolve(1947));
    });

    it('creates tiles from screenshot', async () => {
      genericProvider = new GenericProvider('123', 'http:executorUrl', { platform: 'win' }, {}, 'local-poc-poa', 'staging-poc-poa', {});
      genericProvider.createDriver();
      const tiles = await genericProvider.getTiles(false);
      expect(tiles.tiles.length).toEqual(1);
      expect(tiles.tiles[0].navBarHeight).toEqual(0);
      expect(tiles.tiles[0].statusBarHeight).toEqual(0);
      expect(tiles.tiles[0].footerHeight).toEqual(0);
      expect(tiles.tiles[0].headerHeight).toEqual(0);
      expect(Object.keys(tiles)).toContain('domInfoSha');
    });

    it('throws error if driver not initailized', async () => {
      genericProvider = new GenericProvider('123', 'http:executorUrl', { platform: 'win' }, {}, 'local-poc-poa', 'staging-poc-poa', {});
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
      spyOn(DesktopMetaData.prototype, 'browserVersion')
        .and.returnValue('111');
      spyOn(DesktopMetaData.prototype, 'screenResolution')
        .and.returnValue('1980 x 1080');
      spyOn(MobileMetaData.prototype, 'windowSize')
        .and.returnValue(Promise.resolve({ width: 1000, height: 1000 }));
      spyOn(MobileMetaData.prototype, 'orientation')
        .and.returnValue('landscape');
      spyOn(MobileMetaData.prototype, 'deviceName')
        .and.returnValue('mockDeviceName');
      spyOn(MobileMetaData.prototype, 'osVersion')
        .and.returnValue('mockOsVersion');
      spyOn(MobileMetaData.prototype, 'browserName')
        .and.returnValue('mockBrowserName');
      spyOn(MobileMetaData.prototype, 'browserVersion')
        .and.returnValue('111');
      spyOn(MobileMetaData.prototype, 'screenResolution')
        .and.returnValue('1980 x 1080');
    });

    it('returns correct tag for android', async () => {
      genericProvider = new GenericProvider('123', 'http:executorUrl', { platform: 'android', platformName: 'android' }, {}, 'local-poc-poa', 'staging-poc-poa', {});
      spyOn(MobileMetaData.prototype, 'osName').and.returnValue('android');
      await genericProvider.createDriver();
      const tag = await genericProvider.getTag();
      expect(tag).toEqual({
        name: 'mockDeviceName',
        osName: 'android',
        osVersion: 'mockOsVersion',
        width: 1000,
        height: 1000,
        orientation: 'landscape',
        browserName: 'mockBrowserName',
        browserVersion: '111',
        resolution: '1980 x 1080'
      });
    });

    it('returns correct tag for others', async () => {
      genericProvider = new GenericProvider('123', 'http:executorUrl', { platform: 'win' }, {}, 'local-poc-poa', 'staging-poc-poa', {});
      spyOn(MobileMetaData.prototype, 'osName').and.returnValue('mockOsName');
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
        browserVersion: '111',
        resolution: '1980 x 1080'
      });
    });

    it('throws error if driver not initailized', async () => {
      genericProvider = new GenericProvider('123', 'http:executorUrl', { platform: 'win' }, {}, 'local-poc-poa', 'staging-poc-poa', {});
      await expectAsync(genericProvider.getTag()).toBeRejectedWithError('Driver is null, please initialize driver with createDriver().');
    });
  });

  describe('screenshot', () => {
    let getTagSpy;
    let getTilesSpy;
    let iOSGetTagSpy;
    let iOSGetTilesSpy;

    describe('With Desktop', () => {
      let desktopTag;
      let desktopTiles;
      beforeEach(() => {
        desktopTag = {
          name: 'Windows_11_Chrome_103',
          osName: 'Windows',
          osVersion: '11',
          width: 1000,
          height: 1000,
          orientation: 'landscape',
          browserName: 'chrome',
          browserVersion: '103',
          resolution: '1980 x 1080'
        };
        desktopTiles = {
          tiles: [{
            statusBarHeight: 0,
            sha: 'abc',
            navBarHeight: 0,
            headerHeight: 0,
            footerHeight: 0,
            fullscreen: false
          }],
          domInfoSha: 'mock-dom-sha'
        };
        getTagSpy = spyOn(GenericProvider.prototype, 'getTag').and.returnValue(Promise.resolve(desktopTag));
        getTilesSpy = spyOn(GenericProvider.prototype, 'getTiles').and.returnValue(Promise.resolve(desktopTiles));
        spyOn(DesktopMetaData.prototype, 'windowSize')
          .and.returnValue(Promise.resolve({ width: 1920, height: 1080 }));
      });

      it('calls correct funcs', async () => {
        genericProvider = new GenericProvider('123', 'http:executorUrl', { platform: 'win' }, {}, 'local-poc-poa', 'staging-poc-poa', {});
        await genericProvider.createDriver();
        let res = await genericProvider.screenshot('mock-name', {});
        expect(getTagSpy).toHaveBeenCalledTimes(1);
        expect(genericProvider.statusBarHeight).toEqual(0);
        expect(getTilesSpy).toHaveBeenCalledOnceWith(0, 0, false);
        expect(res).toEqual({
          name: 'mock-name',
          tag: desktopTag,
          tiles: desktopTiles.tiles,
          externalDebugUrl: 'https://localhost/v1',
          environmentInfo: 'staging-poc-poa',
          ignoredElementsData: { ignoreElementsData: [] },
          consideredElementsData: { considerElementsData: [] },
          clientInfo: 'local-poc-poa',
          domInfoSha: 'mock-dom-sha',
          metadata: null
        });
      });
    });

    describe('With Mobile iOS', () => {
      let iosTag;
      let iosTiles;

      beforeEach(() => {
        const scrollFactors = { value: [0, 10] };
        iosTag = {
          name: 'iPhone 11 Pro',
          osName: 'iOS',
          osVersion: '15',
          width: 1000,
          height: 1000,
          orientation: 'potrait',
          browserName: 'safari',
          browserVersion: '15',
          resolution: '1980 x 1080'
        };
        iosTiles = {
          tiles: [{
            statusBarHeight: 132,
            sha: 'abc',
            navBarHeight: 0,
            headerHeight: 0,
            footerHeight: 0,
            fullscreen: false
          }],
          domInfoSha: 'mock-dom-sha'
        };
        iOSGetTagSpy = spyOn(GenericProvider.prototype, 'getTag').and.returnValue(Promise.resolve(iosTag));
        iOSGetTilesSpy = spyOn(GenericProvider.prototype, 'getTiles').and.returnValue(Promise.resolve(iosTiles));
        spyOn(DesktopMetaData.prototype, 'windowSize')
          .and.returnValue(Promise.resolve({ width: 1920, height: 1080 }));
        spyOn(Driver.prototype, 'executeScript')
          .and.returnValue(scrollFactors);
      });

      it('calls correct funcs with iOS', async () => {
        genericProvider = new GenericProvider('123', 'http:executorUrl', { platform: 'win' }, {}, 'local-poc-poa', 'staging-poc-poa', {});
        await genericProvider.createDriver();
        let res = await genericProvider.screenshot('mock-name', {});
        expect(iOSGetTagSpy).toHaveBeenCalledTimes(1);
        expect(genericProvider.statusBarHeight).toEqual(132);
        expect(iOSGetTilesSpy).toHaveBeenCalledOnceWith(0, 0, false);
        expect(res).toEqual({
          name: 'mock-name',
          tag: iosTag,
          tiles: iosTiles.tiles,
          externalDebugUrl: 'https://localhost/v1',
          environmentInfo: 'staging-poc-poa',
          ignoredElementsData: { ignoreElementsData: [] },
          consideredElementsData: { considerElementsData: [] },
          clientInfo: 'local-poc-poa',
          domInfoSha: 'mock-dom-sha',
          metadata: null
        });
      });
    });
  });

  describe('getWindowHeight', () => {
    beforeEach(() => {
      spyOn(Driver.prototype, 'executeScript').and.returnValue(Promise.resolve(true));
    });

    it('should call executeScript to get windowHeight', async () => {
      genericProvider = new GenericProvider('123', 'http:executorUrl', { platform: 'win' }, {}, 'local-poc-poa', 'staging-poc-poa', {});
      await genericProvider.createDriver();
      await genericProvider.getWindowHeight();
      expect(genericProvider.driver.executeScript).toHaveBeenCalledTimes(1);
      expect(genericProvider.driver.executeScript).toHaveBeenCalledWith({ script: 'return window.innerHeight', args: [] });
    });
  });

  describe('updatePageShiftFactor', () => {
    let provider;

    describe('When iOS', () => {
      beforeEach(async () => {
        provider = new GenericProvider('123', 'http:executorUrl', { platform: 'win' }, {});
        await provider.createDriver();
        spyOn(Driver.prototype, 'executeScript').and.returnValue({ value: [0, 10] });
        provider.currentTag = { osName: 'iOS' };
        provider.pageYShiftFactor = 0;
        provider.statusBarHeight = 0;
      });

      describe('when element is visible in viewport', () => {
        beforeEach(() => {
          provider.initialScrollFactor = { value: [0, 10] };
        });
        it('should update pageYShiftFactor for iOS when location.y is 0', async () => {
          await provider.updatePageShiftFactor({ y: 0 }, 2);
          expect(provider.pageYShiftFactor).toBe(-20);
        });

        it('should not update pageYShiftFactor for iOS when location.y is not 0', async () => {
          // Location.y is not 0
          await provider.updatePageShiftFactor({ y: 5 }, 2);
          expect(provider.pageYShiftFactor).toBe(0);
        });
      });

      describe('when element is not visible in viewport and iOS scrolls automatically', () => {
        beforeEach(() => {
          provider.initialScrollFactor = { value: [0, 30] };
        });
        it('should update pageYShiftFactor to negative value even if location.y is 0', async () => {
          await provider.updatePageShiftFactor({ y: 0 }, 2);
          expect(provider.pageYShiftFactor).toBe(-50000);
        });

        it('should update pageYShiftFactor to negative value even if location.y is not 0', async () => {
          // Location.y is not 0
          await provider.updatePageShiftFactor({ y: 5 }, 2);
          expect(provider.pageYShiftFactor).toBe(-50000);
        });
      });
    });

    describe('When OS X', () => {
      beforeEach(async () => {
        provider = new GenericProvider('123', 'http:executorUrl', { platform: 'OS X' }, {});
        await provider.createDriver();
        spyOn(Driver.prototype, 'executeScript').and.returnValue({ value: [0, 10] });
        provider.currentTag = { osName: 'OS X' };
        provider.pageYShiftFactor = 0;
        provider.statusBarHeight = 0;
      });

      describe('When Safari browserVersion > 13', () => {
        describe('when element is visible in viewport', () => {
          beforeEach(() => {
            provider.initialScrollFactor = { value: [0, 10] };
            provider.currentTag.browserName = 'safari';
            provider.currentTag.browserVersion = 15;
          });

          it('should not update pageYShiftFactor for OS X if scrolled', async () => {
            await provider.updatePageShiftFactor({ y: 0 }, 1);
            expect(provider.pageYShiftFactor).toBe(0);
          });
        });
      });

      describe('When Safari browserVersion <= 13', () => {
        describe('when element is visible in viewport', () => {
          beforeEach(() => {
            provider.initialScrollFactor = { value: [0, 10] };
            provider.currentTag.browserName = 'safari';
            provider.currentTag.browserVersion = 13;
          });

          it('should update pageYShiftFactor for OS X platforms accordingly if scrolled', async () => {
            await provider.updatePageShiftFactor({ y: 0 }, 1);
            expect(provider.pageYShiftFactor).toBe(-10);
          });
        });
      });
    });

    describe('When Other', () => {
      beforeEach(async () => {
        provider = new GenericProvider('123', 'http:executorUrl', { platform: 'win' }, {});
        await provider.createDriver();
        provider.currentTag = { osName: 'Android' };
        provider.pageYShiftFactor = 0;
      });

      it('should not update pageYShiftFactor for non-iOS platforms', async () => {
        spyOn(Driver.prototype, 'executeScript').and.returnValue({ value: [0, 0] });
        await provider.updatePageShiftFactor({ y: 0 }, 1);
        expect(provider.pageYShiftFactor).toBe(0);
      });

      it('should update pageYShiftFactor for non-iOS platforms accordingly if scrolled', async () => {
        spyOn(Driver.prototype, 'executeScript').and.returnValue({ value: [0, 10] });
        await provider.updatePageShiftFactor({ y: 0 }, 1);
        expect(provider.pageYShiftFactor).toBe(-10);
      });
    });
  });

  describe('getRegionObject', () => {
    let provider;
    let mockLocation = { x: 10, y: 20, width: 100, height: 200 };

    describe('When on Tile 0', () => {
      beforeEach(async () => {
        // mock metadata
        provider = new GenericProvider('123', 'http:executorUrl', { platform: 'win' }, {});
        provider.currentTag = { osName: 'Windows' };
        await provider.createDriver();
        spyOn(DesktopMetaData.prototype, 'devicePixelRatio')
          .and.returnValue(1);
        spyOn(Driver.prototype, 'executeScript')
          .and.returnValue({ value: [0, 0] });
        spyOn(Driver.prototype, 'rect').and.returnValue(Promise.resolve(mockLocation));
      });

      it('should return a JSON object with the correct selector and coordinates for tile 0', async () => {
        await provider.createDriver();

        // Call function with mock data
        const selector = 'mock-selector';
        const result = await provider.getRegionObject(selector, 'mockElementId');

        // Assert expected result
        expect(result.selector).toEqual(selector);
        expect(result.coOrdinates).toEqual({
          top: mockLocation.y,
          bottom: mockLocation.y + mockLocation.height,
          left: mockLocation.x,
          right: mockLocation.x + mockLocation.width
        });
      });
    });

    describe('When on Tile 1', () => {
      beforeEach(async () => {
        // mock metadata
        provider = new GenericProvider('123', 'http:executorUrl', { platform: 'win' }, {});
        provider.currentTag = { osName: 'iOS' };
        await provider.createDriver();
        spyOn(DesktopMetaData.prototype, 'devicePixelRatio')
          .and.returnValue(1);
        spyOn(Driver.prototype, 'executeScript')
          .and.returnValue({ value: [0, 0] });
        spyOn(Driver.prototype, 'rect').and.returnValue(Promise.resolve(mockLocation));
        provider.pageYShiftFactor = -10;
      });

      afterEach(() => {
        provider.pageYShiftFactor = 0;
        provider.currentTag = null;
      });
      it('should return a JSON object with the correct selector and coordinates', async () => {
        await provider.createDriver();

        // Call function with mock data
        const selector = 'mock-selector';
        const result = await provider.getRegionObject(selector, 'mockElementId');

        // Assert expected result
        expect(result.selector).toEqual(selector);
        expect(result.coOrdinates).toEqual({
          top: mockLocation.y + provider.pageYShiftFactor,
          bottom: mockLocation.y + mockLocation.height + provider.pageYShiftFactor,
          left: mockLocation.x,
          right: mockLocation.x + mockLocation.width
        });
      });
    });
  });

  describe('getRegionObjectFromBoundingBox', () => {
    let provider;
    let mockLocation = { x: 10, y: 20, width: 100, height: 200 };
    beforeEach(async () => {
      // mock metadata
      provider = new GenericProvider('123', 'http:executorUrl', { platform: 'win' }, {});
      provider.currentTag = { osName: 'Windows' };
      await provider.createDriver();
      spyOn(DesktopMetaData.prototype, 'devicePixelRatio')
        .and.returnValue(1);
      provider.statusBarHeight = 0;
    });

    describe('When not an iOS', () => {
      it('should return a JSON object with the correct selector and coordinates', async () => {
        // Call function with mock data
        const selector = 'mock-selector';
        const result = await provider.getRegionObjectFromBoundingBox(selector, mockLocation);

        // Assert expected result
        expect(result.selector).toEqual(selector);
        expect(result.coOrdinates).toEqual({
          top: mockLocation.y,
          bottom: mockLocation.y + mockLocation.height,
          left: mockLocation.x,
          right: mockLocation.x + mockLocation.width
        });
      });
    });

    describe('When iOS', () => {
      beforeEach(() => {
        provider.currentTag = { osName: 'iOS' };
        provider.statusBarHeight = 132;
      });
      it('should return a JSON object with the correct selector and coordinates with added statusBarHeight', async () => {
        await provider.createDriver();

        // Call function with mock data
        const selector = 'mock-selector';
        const result = await provider.getRegionObjectFromBoundingBox(selector, mockLocation);

        // Assert expected result
        expect(result.selector).toEqual(selector);
        expect(result.coOrdinates).toEqual({
          top: mockLocation.y + provider.statusBarHeight,
          bottom: mockLocation.y + mockLocation.height + provider.statusBarHeight,
          left: mockLocation.x,
          right: mockLocation.x + mockLocation.width
        });
      });
    });
  });

  describe('getSeleniumRegionsByXpaths', () => {
    let getRegionObjectSpy;
    let provider;
    let xpathResponse = { top: 0, bottom: 500, right: 0, left: 300 };

    beforeEach(async () => {
      provider = new GenericProvider('123', 'http:executorUrl', { platform: 'win' }, {});
      await provider.createDriver();
      getRegionObjectSpy = spyOn(GenericProvider.prototype, 'getRegionObjectFromBoundingBox').and.returnValue(xpathResponse);
    });

    it('should add regions for each xpath', async () => {
      spyOn(Driver.prototype, 'findElementBoundingBox').and.returnValue(Promise.resolve({ x: 0, y: 100, height: 500, width: 300 }));
      const xpaths = ['/xpath/1', '/xpath/2', '/xpath/3'];

      const elementsArray = await provider.getSeleniumRegionsBy('xpath', xpaths);

      expect(provider.driver.findElementBoundingBox).toHaveBeenCalledTimes(3);
      expect(getRegionObjectSpy).toHaveBeenCalledTimes(3);
      expect(elementsArray).toEqual([xpathResponse, xpathResponse, xpathResponse]);
    });

    it('should ignore xpath when element is not found', async () => {
      spyOn(Driver.prototype, 'findElementBoundingBox').and.rejectWith(new Error('Element not found'));
      const xpaths = ['/xpath/1', '/xpath/2', '/xpath/3'];

      const elementsArray = await provider.getSeleniumRegionsBy('xpath', xpaths);

      expect(provider.driver.findElementBoundingBox).toHaveBeenCalledTimes(3);
      expect(getRegionObjectSpy).not.toHaveBeenCalled();
      expect(elementsArray).toEqual([]);
    });
  });

  describe('getSeleniumRegionsBySelector', () => {
    let getRegionObjectSpy;
    let provider;

    beforeEach(async () => {
      provider = new GenericProvider('123', 'http:executorUrl', { platform: 'win' }, {});
      await provider.createDriver();
      getRegionObjectSpy = spyOn(GenericProvider.prototype, 'getRegionObjectFromBoundingBox').and.returnValue({});
    });

    it('should add regions for each id', async () => {
      spyOn(Driver.prototype, 'findElementBoundingBox').and.returnValue(Promise.resolve({ value: { x: 0, y: 100, height: 500, width: 300 } }));
      const ids = ['#id1', '#id2', '#id3'];

      const elementsArray = await provider.getSeleniumRegionsBy('css selector', ids);

      expect(provider.driver.findElementBoundingBox).toHaveBeenCalledTimes(3);
      expect(getRegionObjectSpy).toHaveBeenCalledTimes(3);
      expect(elementsArray).toEqual([{}, {}, {}]);
    });

    it('should ignore id when element is not found', async () => {
      spyOn(Driver.prototype, 'findElementBoundingBox').and.rejectWith(new Error('Element not found'));
      const ids = ['#id1', '#id2', '#id3'];

      const elementsArray = await provider.getSeleniumRegionsBy('css selector', ids);

      expect(provider.driver.findElementBoundingBox).toHaveBeenCalledTimes(3);
      expect(getRegionObjectSpy).not.toHaveBeenCalled();
      expect(elementsArray).toEqual([]);
    });
  });

  describe('getInitialPosition', () => {
    let provider;
    beforeEach(async () => {
      provider = new GenericProvider('123', 'http:executorUrl', { platform: 'win' }, {});
      provider.currentTag = { osName: 'Windows' };
      await provider.createDriver();
    });
    describe('when not IOS', () => {
      it('should not get the initial scroll position', async () => {
        await provider.getInitialPosition();
        expect(provider.initialScrollFactor).toEqual({ value: [0, 0] });
      });
    });

    describe('when IOS', () => {
      let executeScriptSpy;
      beforeEach(() => {
        provider.currentTag = { osName: 'iOS' };
        executeScriptSpy = spyOn(Driver.prototype, 'executeScript');
      });

      afterEach(() => {
        provider.currentTag = null;
      });
      it('should get the initial scroll position', async () => {
        spyOn(Driver.prototype, 'executeScript').and.returnValue({ value: [0, 200] });
        await provider.getInitialPosition();
        expect(executeScriptSpy).toHaveBeenCalledWith({ script: 'return [parseInt(window.scrollX), parseInt(window.scrollY)];', args: [] });
        expect(provider.initialScrollFactor).toEqual({ value: [0, 200] });
      });
    });
  });

  describe('scrollToInitialPosition', () => {
    let provider;
    beforeEach(async () => {
      provider = new GenericProvider('123', 'http:executorUrl', { platform: 'win' }, {});
      provider.currentTag = { osName: 'Windows' };
      await provider.createDriver();
    });
    describe('when not IOS', () => {
      it('should not scroll to position', async () => {
        await provider.scrollToInitialPosition(0, 50);
        expect(spyOn(Driver.prototype, 'executeScript')).toHaveBeenCalledTimes(0);
      });
    });

    describe('when IOS', () => {
      let executeScriptSpy;
      beforeEach(() => {
        provider.currentTag = { osName: 'iOS' };
        provider.initialScrollFactor = { value: [0, 50] };
        executeScriptSpy = spyOn(Driver.prototype, 'executeScript');
      });

      afterEach(() => {
        provider.currentTag = null;
      });
      it('should scroll to position', async () => {
        await provider.scrollToInitialPosition(0, 50);
        expect(executeScriptSpy).toHaveBeenCalledTimes(1);
        expect(executeScriptSpy).toHaveBeenCalledWith({ script: 'window.scrollTo(0, 50)', args: [] });
      });
    });
  });

  describe('getSeleniumRegionsByElement', () => {
    let getRegionObjectSpy;
    let getInitialPositionSpy;
    let scrollToInitialPositionSpy;
    let provider;

    beforeEach(async () => {
      provider = new GenericProvider('123', 'http:executorUrl', { platform: 'win' }, {});
      await provider.createDriver();
      getRegionObjectSpy = spyOn(GenericProvider.prototype, 'getRegionObject').and.returnValue({});
      getInitialPositionSpy = spyOn(GenericProvider.prototype, 'getInitialPosition');
      scrollToInitialPositionSpy = spyOn(GenericProvider.prototype, 'scrollToInitialPosition');
    });

    it('should add regions for each element', async () => {
      const elements = ['mockElement_1', 'mockElement_2', 'mockElement_3'];

      const elementsArray = await provider.getSeleniumRegionsByElement(elements);
      expect(getInitialPositionSpy).toHaveBeenCalledTimes(1);
      expect(getRegionObjectSpy).toHaveBeenCalledTimes(3);
      expect(scrollToInitialPositionSpy).toHaveBeenCalledTimes(1);
      expect(scrollToInitialPositionSpy).toHaveBeenCalledWith(provider.initialScrollFactor.value[0], provider.initialScrollFactor.value[1]);
      expect(elementsArray).toEqual([{}, {}, {}]);
    });

    it('should ignore when error', async () => {
      getRegionObjectSpy.and.rejectWith(new Error('Element not found'));
      const elements = ['mockElement_1', 'mockElement_2', 'mockElement_3'];

      const elementsArray = await provider.getSeleniumRegionsByElement(elements);

      expect(elementsArray).toEqual([]);
    });
  });

  describe('getSeleniumRegionsByLocation', () => {
    let provider;

    beforeEach(async () => {
      provider = new GenericProvider('123', 'http:executorUrl', { platform: 'win' }, {});
      await provider.createDriver();
      spyOn(DesktopMetaData.prototype, 'windowSize')
        .and.returnValue(Promise.resolve({ width: 1920, height: 1080 }));
    });

    it('should add custom regions to the provided array', async () => {
      const customLocations = [
        { top: 100, bottom: 200, left: 100, right: 200 },
        { top: 300, bottom: 400, left: 300, right: 400 }
      ];

      const elementsArray = await provider.getSeleniumRegionsByLocation(customLocations);

      expect(elementsArray).toEqual([
        {
          selector: 'custom region 0',
          coOrdinates: { top: 100, bottom: 200, left: 100, right: 200 }
        },
        {
          selector: 'custom region 1',
          coOrdinates: { top: 300, bottom: 400, left: 300, right: 400 }
        }
      ]);
    });

    it('should ignore invalid custom regions', async () => {
      const customLocations = [
        { top: 100, bottom: 1090, left: 100, right: 200 },
        { top: 300, bottom: 400, left: 300, right: 1921 }
      ];

      const elementsArray = await provider.getSeleniumRegionsByLocation(customLocations);

      expect(elementsArray).toEqual([]);
    });
  });

  describe('findRegions', () => {
    let provider;
    let doTransformationSpy;
    let undoTransformationSpy;
    let getSeleniumRegionsBySpy;
    let getSeleniumRegionsByElementSpy;
    let getSeleniumRegionsByLocationSpy;
    const location = [
      { top: 100, bottom: 1090, left: 100, right: 200 }
    ];

    beforeEach(async () => {
      provider = new GenericProvider('123', 'http:executorUrl', { platform: 'win' }, {});
      await provider.createDriver();
      doTransformationSpy = spyOn(GenericProvider.prototype, 'doTransformations');
      undoTransformationSpy = spyOn(GenericProvider.prototype, 'undoTransformations');
      getSeleniumRegionsBySpy = spyOn(GenericProvider.prototype, 'getSeleniumRegionsBy').and.returnValue(Promise.resolve(location));
      getSeleniumRegionsByElementSpy = spyOn(GenericProvider.prototype, 'getSeleniumRegionsByElement').and.returnValue(Promise.resolve([]));
      getSeleniumRegionsByLocationSpy = spyOn(GenericProvider.prototype, 'getSeleniumRegionsByLocation').and.returnValue(Promise.resolve([]));
    });

    describe('When no regions are passed', () => {
      it('should return empty array when called and no transformation should be applied', async () => {
        const xpath = [];
        const selector = [];
        const seleniumElements = [];
        const customRegions = [];
        const res = await provider.findRegions(xpath, selector, seleniumElements, customRegions);
        expect(doTransformationSpy).not.toHaveBeenCalled();
        expect(undoTransformationSpy).not.toHaveBeenCalled();
        expect(res).toEqual([]);
      });
    });

    describe('When regions are passed', () => {
      it('should return array when called transformation should be applied', async () => {
        const xpath = ['/a/b/c'];
        const selector = [];
        const seleniumElements = [];
        const customRegions = [];
        await provider.findRegions(xpath, selector, seleniumElements, customRegions);
        expect(doTransformationSpy).toHaveBeenCalled();
        expect(getSeleniumRegionsBySpy).toHaveBeenCalledTimes(2);
        expect(getSeleniumRegionsByElementSpy).toHaveBeenCalledTimes(1);
        expect(getSeleniumRegionsByLocationSpy).toHaveBeenCalledTimes(1);
        expect(undoTransformationSpy).toHaveBeenCalled();
      });
    });
  });

  describe('doTransformations', () => {
    let provider;
    let executeScriptSpy;

    beforeEach(async () => {
      provider = new GenericProvider('123', 'http:executorUrl', { platform: 'win' }, {});
      await provider.createDriver();
      executeScriptSpy = spyOn(Driver.prototype, 'executeScript');
    });

    it('should do transfomation', async () => {
      const hideScrollbarStyle = `
    /* Hide scrollbar for Chrome, Safari and Opera */
    ::-webkit-scrollbar {
      display: none !important;
    }

    /* Hide scrollbar for IE, Edge and Firefox */
    body, html {
      -ms-overflow-style: none !important;  /* IE and Edge */
      scrollbar-width: none !important;  /* Firefox */
    }`.replace(/\n/g, '');
      const jsScript = `
    const e = document.createElement('style');
    e.setAttribute('class', 'poa-injected');
    e.innerHTML = '${hideScrollbarStyle}'
    document.head.appendChild(e);`;
      await provider.doTransformations();
      expect(executeScriptSpy).toHaveBeenCalledWith({ script: jsScript, args: [] });
    });
  });

  describe('undoTransformations', () => {
    let provider;
    let executeScriptSpy;

    beforeEach(async () => {
      provider = new GenericProvider('123', 'http:executorUrl', { platform: 'win' }, {});
      await provider.createDriver();
      executeScriptSpy = spyOn(Driver.prototype, 'executeScript');
    });

    it('should remove transfomation', async () => {
      const data = '.abcdef';
      const jsScript = `
      const n = document.querySelectorAll('${data}');
      n.forEach((e) => {e.remove()});`;

      await provider.undoTransformations(data);
      expect(executeScriptSpy).toHaveBeenCalledWith({ script: jsScript, args: [] });
    });
  });
});
