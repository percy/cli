import GenericProvider from '../../src/providers/genericProvider.js';
import Driver from '../../src/driver.js';
import MetaDataResolver from '../../src/metadata/metaDataResolver.js';
import DesktopMetaData from '../../src/metadata/desktopMetaData.js';
import utils from '@percy/sdk-utils';
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
      expectedDriver = new Driver('123', 'http:executorUrl');
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
      spyOn(GenericProvider.prototype, 'getHeaderFooter').and.returnValue(Promise.resolve([123, 456]));
    });

    it('creates tiles from screenshot', async () => {
      genericProvider = new GenericProvider('123', 'http:executorUrl', { platform: 'win' }, {}, 'local-poc-poa', 'staging-poc-poa', {});
      genericProvider.createDriver();
      const tiles = await genericProvider.getTiles(123, 456, false);
      expect(tiles.tiles.length).toEqual(1);
      expect(tiles.tiles[0].navBarHeight).toEqual(0);
      expect(tiles.tiles[0].statusBarHeight).toEqual(0);
      expect(tiles.tiles[0].footerHeight).toEqual(456);
      expect(tiles.tiles[0].headerHeight).toEqual(123);
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
      spyOn(MobileMetaData.prototype, 'osName')
        .and.returnValue('mockOsName');
      spyOn(MobileMetaData.prototype, 'osVersion')
        .and.returnValue('mockOsVersion');
      spyOn(MobileMetaData.prototype, 'browserName')
        .and.returnValue('mockBrowserName');
      spyOn(MobileMetaData.prototype, 'browserVersion')
        .and.returnValue('111');
      spyOn(MobileMetaData.prototype, 'screenResolution')
        .and.returnValue('1980 x 1080');
      spyOn(GenericProvider.prototype, 'getHeaderFooter').and.returnValue(Promise.resolve([123, 456]));
    });

    it('returns correct tag for android', async () => {
      genericProvider = new GenericProvider('123', 'http:executorUrl', { platform: 'android', platformName: 'android' }, {}, 'local-poc-poa', 'staging-poc-poa', {});
      await genericProvider.createDriver();
      const tag = await genericProvider.getTag();
      expect(tag).toEqual({
        name: 'mockDeviceName',
        osName: 'mockOsName',
        osVersion: 'mockOsVersion',
        width: 1000,
        height: 1000 + 123 + 456,
        orientation: 'landscape',
        browserName: 'mockBrowserName',
        browserVersion: '111',
        resolution: '1980 x 1080'
      });
    });

    it('returns correct tag for others', async () => {
      genericProvider = new GenericProvider('123', 'http:executorUrl', { platform: 'win' }, {}, 'local-poc-poa', 'staging-poc-poa', {});
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
    let addPercyCSSSpy;
    let removePercyCSSSpy;

    beforeEach(() => {
      getTagSpy = spyOn(GenericProvider.prototype, 'getTag').and.returnValue(Promise.resolve('mock-tag'));
      getTilesSpy = spyOn(GenericProvider.prototype, 'getTiles').and.returnValue(Promise.resolve({ tiles: 'mock-tile', domInfoSha: 'mock-dom-sha' }));
      addPercyCSSSpy = spyOn(GenericProvider.prototype, 'addPercyCSS').and.returnValue(Promise.resolve(true));
      removePercyCSSSpy = spyOn(GenericProvider.prototype, 'removePercyCSS').and.returnValue(Promise.resolve(true));
      spyOn(DesktopMetaData.prototype, 'windowSize')
        .and.returnValue(Promise.resolve({ width: 1920, height: 1080 }));
    });

    it('calls correct funcs', async () => {
      genericProvider = new GenericProvider('123', 'http:executorUrl', { platform: 'win' }, {}, 'local-poc-poa', 'staging-poc-poa', {});
      await genericProvider.createDriver();
      let res = await genericProvider.screenshot('mock-name', {});
      const defaultPercyCSS = genericProvider.defaultPercyCSS().split('\n').join('');
      expect(addPercyCSSSpy).toHaveBeenCalledTimes(1);
      expect(addPercyCSSSpy).toHaveBeenCalledWith(defaultPercyCSS);
      expect(getTagSpy).toHaveBeenCalledTimes(1);
      expect(getTilesSpy).toHaveBeenCalledOnceWith(0, 0, false);
      expect(removePercyCSSSpy).toHaveBeenCalledTimes(1);
      expect(res).toEqual({
        name: 'mock-name',
        tag: 'mock-tag',
        tiles: 'mock-tile',
        externalDebugUrl: 'https://localhost/v1',
        environmentInfo: 'staging-poc-poa',
        ignoredElementsData: { ignoreElementsData: [] },
        clientInfo: 'local-poc-poa',
        domInfoSha: 'mock-dom-sha'
      });
    });
  });

  describe('defaultPercyCSS', () => {
    const expectedResult = `*, *::before, *::after {
      -moz-transition: none !important;
      transition: none !important;
      -moz-animation: none !important;
      animation: none !important;
      animation-duration: 0 !important;
      caret-color: transparent !important;
      content-visibility: visible !important;
    }
    html{
      scrollbar-width: auto !important;
    }
    svg {
      shape-rendering: geometricPrecision !important;
    }
    scrollbar, scrollcorner, scrollbar thumb, scrollbar scrollbarbutton {
      pointer-events: none !important;
      -moz-appearance: none !important;
      display: none !important;
    }
    video::-webkit-media-controls {
      display: none !important;
    }`;

    it('should return defaultPercyCSS', () => {
      genericProvider = new GenericProvider('123', 'http:executorUrl', { platform: 'win' }, {}, 'local-poc-poa', 'staging-poc-poa', {});
      const resp = genericProvider.defaultPercyCSS();
      expect(resp).toBe(expectedResult);
    });
  });

  describe('addPercyCSS', () => {
    beforeEach(() => {
      spyOn(Driver.prototype, 'executeScript').and.returnValue(Promise.resolve(true));
    });

    it('should call executeScript to add style', async () => {
      genericProvider = new GenericProvider('123', 'http:executorUrl', { platform: 'win' }, {}, 'local-poc-poa', 'staging-poc-poa', {});
      await genericProvider.createDriver();
      const percyCSS = 'h1{color:green !important;}';
      await genericProvider.addPercyCSS(percyCSS);
      const expectedArgs = `const e = document.createElement('style');
      e.setAttribute('data-percy-specific-css', true);
      e.innerHTML = '${percyCSS}';
      document.body.appendChild(e);`;
      expect(genericProvider.driver.executeScript).toHaveBeenCalledTimes(1);
      expect(genericProvider.driver.executeScript).toHaveBeenCalledWith({ script: expectedArgs, args: [] });
    });
  });

  describe('removePercyCSS', () => {
    beforeEach(() => {
      spyOn(Driver.prototype, 'executeScript').and.returnValue(Promise.resolve(true));
    });

    it('should call executeScript to add style', async () => {
      genericProvider = new GenericProvider('123', 'http:executorUrl', { platform: 'win' }, {}, 'local-poc-poa', 'staging-poc-poa', {});
      await genericProvider.createDriver();
      await genericProvider.removePercyCSS();
      const expectedArgs = `const n = document.querySelector('[data-percy-specific-css]');
      n.remove();`;
      expect(genericProvider.driver.executeScript).toHaveBeenCalledTimes(1);
      expect(genericProvider.driver.executeScript).toHaveBeenCalledWith({ script: expectedArgs, args: [] });
    });
  });

  describe('ignoreElementObject', () => {
    let provider;
    let mockLocation = { x: 10, y: 20, width: 100, height: 200 };
    beforeEach(() => {
      // mock metadata
      provider = new GenericProvider('123', 'http:executorUrl', { platform: 'win' }, {});
      spyOn(DesktopMetaData.prototype, 'devicePixelRatio')
        .and.returnValue(1);
      spyOn(Driver.prototype, 'rect').and.returnValue(Promise.resolve(mockLocation));
    });

    it('should return a JSON object with the correct selector and coordinates', async () => {
      await provider.createDriver();

      // Call function with mock data
      const selector = 'mock-selector';
      const result = await provider.ignoreElementObject(selector, 'mockElementId');

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

  describe('getIgnoreRegionsByXpaths', () => {
    let ignoreElementObjectSpy;
    let provider;

    beforeEach(async () => {
      provider = new GenericProvider('123', 'http:executorUrl', { platform: 'win' }, {});
      await provider.createDriver();
      ignoreElementObjectSpy = spyOn(GenericProvider.prototype, 'ignoreElementObject').and.returnValue({});
    });

    it('should ignore regions for each xpath', async () => {
      spyOn(Driver.prototype, 'findElement').and.returnValue(Promise.resolve({ ELEMENT: 'mock_id' }));
      const xpaths = ['/xpath/1', '/xpath/2', '/xpath/3'];

      const ignoredElementsArray = await provider.getIgnoreRegionsBy('xpath', xpaths);

      expect(provider.driver.findElement).toHaveBeenCalledTimes(3);
      expect(ignoreElementObjectSpy).toHaveBeenCalledTimes(3);
      expect(ignoredElementsArray).toEqual([{}, {}, {}]);
    });

    it('should ignore xpath when element is not found', async () => {
      spyOn(Driver.prototype, 'findElement').and.rejectWith(new Error('Element not found'));
      const xpaths = ['/xpath/1', '/xpath/2', '/xpath/3'];

      const ignoredElementsArray = await provider.getIgnoreRegionsBy('xpath', xpaths);

      expect(provider.driver.findElement).toHaveBeenCalledTimes(3);
      expect(ignoreElementObjectSpy).not.toHaveBeenCalled();
      expect(ignoredElementsArray).toEqual([]);
    });
  });

  describe('getIgnoreRegionsBySelector', () => {
    let ignoreElementObjectSpy;
    let provider;

    beforeEach(async () => {
      provider = new GenericProvider('123', 'http:executorUrl', { platform: 'win' }, {});
      await provider.createDriver();
      ignoreElementObjectSpy = spyOn(GenericProvider.prototype, 'ignoreElementObject').and.returnValue({});
    });

    it('should ignore regions for each id', async () => {
      spyOn(Driver.prototype, 'findElement').and.returnValue(Promise.resolve({ ELEMENT: 'mock_id' }));
      const ids = ['#id1', '#id2', '#id3'];

      const ignoredElementsArray = await provider.getIgnoreRegionsBy('css selector', ids);

      expect(provider.driver.findElement).toHaveBeenCalledTimes(3);
      expect(ignoreElementObjectSpy).toHaveBeenCalledTimes(3);
      expect(ignoredElementsArray).toEqual([{}, {}, {}]);
    });

    it('should ignore id when element is not found', async () => {
      spyOn(Driver.prototype, 'findElement').and.rejectWith(new Error('Element not found'));
      const ids = ['#id1', '#id2', '#id3'];

      const ignoredElementsArray = await provider.getIgnoreRegionsBy('css selector', ids);

      expect(provider.driver.findElement).toHaveBeenCalledTimes(3);
      expect(ignoreElementObjectSpy).not.toHaveBeenCalled();
      expect(ignoredElementsArray).toEqual([]);
    });
  });

  describe('getIgnoreRegionsByElement', () => {
    let ignoreElementObjectSpy;
    let provider;

    beforeEach(async () => {
      provider = new GenericProvider('123', 'http:executorUrl', { platform: 'win' }, {});
      await provider.createDriver();
      ignoreElementObjectSpy = spyOn(GenericProvider.prototype, 'ignoreElementObject').and.returnValue({});
    });

    it('should ignore regions for each element', async () => {
      const elements = ['mockElement_1', 'mockElement_2', 'mockElement_3'];

      const ignoredElementsArray = await provider.getIgnoreRegionsByElement(elements);

      expect(ignoreElementObjectSpy).toHaveBeenCalledTimes(3);
      expect(ignoredElementsArray).toEqual([{}, {}, {}]);
    });

    it('should ignore when error', async () => {
      ignoreElementObjectSpy.and.rejectWith(new Error('Element not found'));
      const elements = ['mockElement_1', 'mockElement_2', 'mockElement_3'];

      const ignoredElementsArray = await provider.getIgnoreRegionsByElement(elements);

      expect(ignoredElementsArray).toEqual([]);
    });
  });

  describe('addCustomIgnoreRegions function', () => {
    let provider;

    beforeEach(async () => {
      provider = new GenericProvider('123', 'http:executorUrl', { platform: 'win' }, {});
      await provider.createDriver();
      spyOn(DesktopMetaData.prototype, 'windowSize')
        .and.returnValue(Promise.resolve({ width: 1920, height: 1080 }));
    });

    it('should add custom ignore regions to the provided array', async () => {
      const customLocations = [
        { top: 100, bottom: 200, left: 100, right: 200 },
        { top: 300, bottom: 400, left: 300, right: 400 }
      ];

      const ignoredElementsArray = await provider.getCustomIgnoreRegions(customLocations);

      expect(ignoredElementsArray).toEqual([
        {
          selector: 'custom ignore region 0',
          coOrdinates: { top: 100, bottom: 200, left: 100, right: 200 }
        },
        {
          selector: 'custom ignore region 1',
          coOrdinates: { top: 300, bottom: 400, left: 300, right: 400 }
        }
      ]);
    });

    it('should ignore invalid custom ignore regions', async () => {
      const customLocations = [
        { top: 100, bottom: 1090, left: 100, right: 200 },
        { top: 300, bottom: 400, left: 300, right: 1921 }
      ];

      const ignoredElementsArray = await provider.getCustomIgnoreRegions(customLocations);

      expect(ignoredElementsArray).toEqual([]);
    });
  });

  describe('getHeaderFooter', () => {
    let provider;

    beforeEach(async () => {
      provider = new GenericProvider('123', 'http:executorUrl', { browserName: 'safari', deviceName: 'iPhone 12 Pro' }, {});
    });

    it('should return the matching header and footer', async () => {
      let mockResponseObject = {
        body: {
          'iPhone 12 Pro': {
            safari: {
              header: 141,
              footer: 399
            }
          }
        },
        status: 200,
        headers: { 'content-type': 'application/json' }
      };
      spyOn(utils.request, 'fetch').and.returnValue(
        Promise.resolve(mockResponseObject)
      );
      const [header, footer] = await provider.getHeaderFooter();
      expect(header).toEqual(141);
      expect(footer).toEqual(399);
    });

    it('should return 0,0 for unmatched device name', async () => {
      let mockResponseObject = {
        body: {
          'iPhone 13 Pro': {
            safari: {
              header: 141,
              footer: 399
            }
          }
        },
        status: 200,
        headers: { 'content-type': 'application/json' }
      };
      spyOn(utils.request, 'fetch').and.returnValue(
        Promise.resolve(mockResponseObject)
      );
      const [header, footer] = await provider.getHeaderFooter();
      expect(header).toEqual(0);
      expect(footer).toEqual(0);
    });

    it('should return 0,0 for unmatched browser name', async () => {
      let mockResponseObject = {
        body: {
          'iPhone 12 Pro': {
            chrome: {
              header: 141,
              footer: 399
            }
          }
        },
        status: 200,
        headers: { 'content-type': 'application/json' }
      };
      spyOn(utils.request, 'fetch').and.returnValue(
        Promise.resolve(mockResponseObject)
      );
      const [header, footer] = await provider.getHeaderFooter();
      expect(header).toEqual(0);
      expect(footer).toEqual(0);
    });
  });
});
