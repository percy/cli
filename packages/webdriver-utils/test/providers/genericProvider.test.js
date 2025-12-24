import GenericProvider from '../../src/providers/genericProvider.js';
import Driver from '../../src/driver.js';
import MetaDataResolver from '../../src/metadata/metaDataResolver.js';
import DesktopMetaData from '../../src/metadata/desktopMetaData.js';

describe('GenericProvider', () => {
  let genericProvider;
  let capabilitiesSpy;
  let args;

  beforeEach(() => {
    args = {
      sessionId: '123',
      commandExecutorUrl: 'http:executorUrl',
      capabilities: { platform: 'win' },
      sessionCapabilities: {},
      clientInfo: 'local-poc-poa',
      environmentInfo: 'staging-poc-poa',
      options: {}
    };
    capabilitiesSpy = spyOn(Driver.prototype, 'getCapabilites')
      .and.returnValue(Promise.resolve({ browserName: 'Chrome' }));
  });

  describe('sortPlatforms', () => {
    it('prioritizes specific versions over latest/missing while preserving relative order', () => {
      const provider = new GenericProvider({ options: {} });
      const input = [
        { browserVersion: 'latest', id: 1 },
        { browserVersion: '120', id: 2 },
        { id: 3 },
        { browserVersion: '118', id: 4 },
        { browserVersion: 'Latest', id: 5 }
      ];
      const out = provider.sortPlatforms(input);
      expect(out.map(p => p.id)).toEqual([2, 4, 1, 3, 5]);
    });
  });

  describe('addDefaultOptions', () => {
    it('maps freezeAnimatedImage/freezeAnimation into options.freezeAnimation', () => {
      let provider = new GenericProvider({ options: { freezeAnimatedImage: true } });
      provider.addDefaultOptions();
      expect(provider.options.freezeAnimation).toBeTrue();

      provider = new GenericProvider({ options: { freezeAnimation: true } });
      provider.addDefaultOptions();
      expect(provider.options.freezeAnimation).toBeTrue();

      provider = new GenericProvider({ options: {} });
      provider.addDefaultOptions();
      expect(provider.options.freezeAnimation).toBeFalse();
    });
  });

  describe('supports', () => {
    it('always returns true', () => {
      expect(GenericProvider.supports('http://executor')).toBeTrue();
    });
  });

  describe('client/environment info aggregation', () => {
    it('adds non-empty values to sets', () => {
      const provider = new GenericProvider({ clientInfo: ['a', null, 'b'], environmentInfo: 'env', options: {} });
      expect([...provider.clientInfoDetails]).toEqual(['a', 'b']);
      expect([...provider.environmentInfoDetails]).toEqual(['env']);
    });
  });

  describe('setDebugUrl', () => {
    it('sets default debug url', async () => {
      const provider = new GenericProvider(args);
      await provider.setDebugUrl();
      expect(provider.debugUrl).toBe('https://localhost/v1');
    });
  });

  describe('percyScreenshotBegin', () => {
    beforeEach(() => {
      args.buildInfo = { id: 'b1', url: 'http://build' };
    });

    it('marks session as percy on success', async () => {
      const provider = new GenericProvider(args);
      await provider.createDriver();
      spyOn(GenericProvider.prototype, 'browserstackExecutor').and.returnValue(Promise.resolve({ success: true }));
      const res = await provider.percyScreenshotBegin('snap');
      expect(res).toEqual({ success: true });
      expect(provider._markedPercy).toBeTrue();
    });

    it('throws with status 13 using Selenium dialect body', async () => {
      const provider = new GenericProvider(args);
      await provider.createDriver();
      spyOn(GenericProvider.prototype, 'browserstackExecutor').and.returnValue(Promise.resolve({ status: 13, value: 'bad' }));
      await expectAsync(provider.percyScreenshotBegin('snap')).toBeRejectedWithError('bad');
    });

    it('throws with parsed W3C error body', async () => {
      const provider = new GenericProvider(args);
      await provider.createDriver();
      const err = new Error('boom');
      err.response = { body: JSON.stringify({ value: { error: 'unknown error', message: 'w3c fail' } }) };
      spyOn(GenericProvider.prototype, 'browserstackExecutor').and.callFake(() => { throw err; });
      await expectAsync(provider.percyScreenshotBegin('snap')).toBeRejectedWithError('w3c fail');
    });
  });

  describe('percyScreenshotEnd', () => {
    beforeEach(() => {
      args.options = { sync: true };
    });
    it('swallows errors and logs when executor fails', async () => {
      const provider = new GenericProvider(args);
      await provider.createDriver();
      spyOn(GenericProvider.prototype, 'browserstackExecutor').and.throwError('fail');
      await provider.percyScreenshotEnd('snap', new Error('x'));
      // no throw expected
      expect(GenericProvider.prototype.browserstackExecutor).toHaveBeenCalled();
    });
  });

  describe('resolvePercyBrowserCustomNameFor', () => {
    it('returns null when platforms array is empty', () => {
      const provider = new GenericProvider({ options: { platforms: [] } });
      const name = provider.resolvePercyBrowserCustomNameFor({ osName: 'Windows', browserName: 'Chrome' });
      expect(name).toBeNull();
    });

    it('returns null when no platforms provided', () => {
      const provider = new GenericProvider({ options: {} });
      const name = provider.resolvePercyBrowserCustomNameFor({ osName: 'Windows', browserName: 'Chrome' });
      expect(name).toBeNull();
    });

    it('matches by normalized fields, includes version, and device when mobile', () => {
      const platforms = [
        { os: 'Windows', browserName: 'Chrome', browserVersion: 118, percyBrowserCustomName: 'win-chrome-118' },
        { os: 'Windows', browserName: 'Chrome', browserVersion: 'latest', percyBrowserCustomName: 'win-chrome-latest' },
        { os: 'iOS', deviceName: 'iPhone 12', browserName: 'Safari', browserVersion: 'latest', percyBrowserCustomName: 'ios-safari-iphone12' },
        { os: 'iOS', deviceName: 'iPhone 13', percyBrowserCustomName: 'ios-safari-iphone13' }
      ];
      const provider = new GenericProvider({ options: { platforms } });
      // exact specific version wins over latest
      const name1 = provider.resolvePercyBrowserCustomNameFor({ osName: 'Windows', browserName: 'chrome', browserVersion: '118.0' });
      expect(name1).toBe('win-chrome-118');
      // latest used when specific not found
      const name2 = provider.resolvePercyBrowserCustomNameFor({ osName: 'Windows', browserName: 'Chrome', browserVersion: '200' });
      expect(name2).toBe('win-chrome-latest');
      // mobile requires device match
      const name3 = provider.resolvePercyBrowserCustomNameFor({ osName: 'iOS', browserName: 'Safari', browserVersion: '17', deviceName: 'iPhone 12', isMobile: true });
      expect(name3).toBe('ios-safari-iphone12');
      // when no match returns null
      const name4 = provider.resolvePercyBrowserCustomNameFor({ osName: '', browserName: 'Chrome' });
      expect(name4).toBeNull();
    });

    it('uses alternative platform property names (os, device)', () => {
      const platforms = [
        { os: 'Windows', osVersion: 11, browserName: 'Chrome', percyBrowserCustomName: 'win-chrome' },
        { osName: 'iOS', device: 'iPhone 13', browserName: 'Safari', percyBrowserCustomName: 'ios-safari-iphone13' }
      ];
      const provider = new GenericProvider({ options: { platforms } });

      const name1 = provider.resolvePercyBrowserCustomNameFor({ osName: 'Windows', osVersion: 11, browserName: 'Chrome' });
      expect(name1).toBe('win-chrome');

      const name2 = provider.resolvePercyBrowserCustomNameFor({ osName: 'iOS', osVersion: 'iphone', browserName: 'Safari', deviceName: 'iPhone 13', isMobile: true });
      expect(name2).toBe('ios-safari-iphone13');
    });

    it('normalizes platform osName using normalizeTags.osRollUp', () => {
      const platforms = [
        { osName: 'mac', browserName: 'Chrome', percyBrowserCustomName: 'mac-chrome' },
        { osName: 'Windows 10', browserName: 'Firefox', percyBrowserCustomName: 'win-firefox' }
      ];
      const provider = new GenericProvider({ options: { platforms } });

      // Should match after normalization (mac -> OS X)
      const name1 = provider.resolvePercyBrowserCustomNameFor({ osName: 'OS X', browserName: 'Chrome' });
      expect(name1).toBe('mac-chrome');

      // Should match after normalization (Windows 10 -> Windows)
      const name2 = provider.resolvePercyBrowserCustomNameFor({ osName: 'Windows', browserName: 'Firefox' });
      expect(name2).toBe('win-firefox');
    });

    it('normalizes platform osVersion using normalizeTags.osVersionRollUp', () => {
      const platforms = [
        { osName: 'iOS', osVersion: '15.0', browserName: 'Safari', percyBrowserCustomName: 'ios15-safari' },
        { osName: 'Android', osVersion: '12.0', browserName: 'Chrome', percyBrowserCustomName: 'android12-chrome' }
      ];
      const provider = new GenericProvider({ options: { platforms } });

      // Should match after version normalization
      const name1 = provider.resolvePercyBrowserCustomNameFor({ osName: 'iOS', osVersion: '15', browserName: 'Safari' });
      expect(name1).toBe('ios15-safari');

      const name2 = provider.resolvePercyBrowserCustomNameFor({ osName: 'Android', osVersion: '12', browserName: 'Chrome' });
      expect(name2).toBe('android12-chrome');
    });

    it('normalizes platform browserName using normalizeTags.browserRollUp', () => {
      const platforms = [
        { osName: 'Windows', browserName: 'chrome', percyBrowserCustomName: 'win-chrome' },
        { osName: 'iphone', browserName: 'iphone', percyBrowserCustomName: 'iphone-ios' }
      ];
      const provider = new GenericProvider({ options: { platforms } });

      // Should match after browser name normalization
      const name1 = provider.resolvePercyBrowserCustomNameFor({ osName: 'Windows', browserName: 'Chrome', isMobile: false });
      expect(name1).toBe('win-chrome');

      const name2 = provider.resolvePercyBrowserCustomNameFor({ osName: 'ios', browserName: 'safari', isMobile: true });
      expect(name2).toBe('iphone-ios');
    });

    it('normalizes platform browserVersion using normalizeTags.browserVersionOrDeviceNameRollup', () => {
      const platforms = [
        { osName: 'Windows', browserName: 'Chrome', browserVersion: '120.0.0', percyBrowserCustomName: 'win-chrome-120' },
        { osName: 'OS X', browserName: 'Safari', browserVersion: '17.0', percyBrowserCustomName: 'mac-safari-17' }
      ];
      const provider = new GenericProvider({ options: { platforms } });

      // Should match after version normalization
      const name1 = provider.resolvePercyBrowserCustomNameFor({ osName: 'Windows', browserName: 'Chrome', browserVersion: '120' });
      expect(name1).toBe('win-chrome-120');

      const name2 = provider.resolvePercyBrowserCustomNameFor({ osName: 'OS X', browserName: 'Safari', browserVersion: '17' });
      expect(name2).toBe('mac-safari-17');
    });

    it('normalizes all platform properties together for accurate matching', () => {
      const platforms = [
        {
          osName: 'mac',
          osVersion: '13.0',
          browserName: 'chrome',
          browserVersion: '118.0.0',
          percyBrowserCustomName: 'normalized-match'
        }
      ];
      const provider = new GenericProvider({ options: { platforms } });

      // All properties should be normalized before matching
      const name = provider.resolvePercyBrowserCustomNameFor({
        osName: 'OS X',
        osVersion: '13',
        browserName: 'Chrome',
        browserVersion: '118'
      });
      expect(name).toBe('normalized-match');
    });

    it('handles includes with null or empty values in version check', () => {
      const platforms = [
        { osName: 'Windows', browserName: 'Chrome', browserVersion: '', percyBrowserCustomName: 'win-chrome-empty' }
      ];
      const provider = new GenericProvider({ options: { platforms } });

      const name = provider.resolvePercyBrowserCustomNameFor({ osName: 'Windows', browserName: 'Chrome', browserVersion: '118' });
      expect(name).toBe('win-chrome-empty');
    });

    it('continues to next platform when mobile device does not match', () => {
      const platforms = [
        { osName: 'iOS', deviceName: 'iPhone 12', browserName: 'Safari', percyBrowserCustomName: 'ios-safari-iphone12' },
        { osName: 'iOS', deviceName: 'iPhone 13', browserName: 'Safari', percyBrowserCustomName: 'ios-safari-iphone13' }
      ];
      const provider = new GenericProvider({ options: { platforms } });

      const name = provider.resolvePercyBrowserCustomNameFor({ osName: 'iOS', browserName: 'Safari', deviceName: 'iPhone 13', isMobile: true });
      expect(name).toBe('ios-safari-iphone13');
    });

    it('returns null when mobile device name does not match any platform', () => {
      const platforms = [
        { osName: 'iOS', deviceName: 'iPhone 12', browserName: 'Safari', percyBrowserCustomName: 'ios-safari-iphone12' }
      ];
      const provider = new GenericProvider({ options: { platforms } });

      const name = provider.resolvePercyBrowserCustomNameFor({ osName: 'iOS', browserName: 'Safari', deviceName: 'iPhone 14', isMobile: true });
      expect(name).toBeNull();
    });
  });

  describe('createDriver', () => {
    let metaDataResolverSpy;
    let expectedDriver;

    beforeEach(() => {
      metaDataResolverSpy = spyOn(MetaDataResolver, 'resolve');
      args.capabilities = {};
      expectedDriver = new Driver('123', 'http:executorUrl', {});
    });

    it('creates driver', async () => {
      genericProvider = new GenericProvider(args);
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
      genericProvider = new GenericProvider(args);
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
      genericProvider = new GenericProvider(args);
      await expectAsync(genericProvider.getTiles(false)).toBeRejectedWithError('Driver is null, please initialize driver with createDriver().');
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
        genericProvider = new GenericProvider(args);
        await genericProvider.createDriver();
        let res = await genericProvider.screenshot('mock-name', {});
        expect(getTagSpy).toHaveBeenCalledTimes(1);
        expect(genericProvider.statusBarHeight).toEqual(0);
        expect(getTilesSpy).toHaveBeenCalledOnceWith(false);
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
          regions: null,
          algorithm: null,
          algorithmConfiguration: null,
          metadata: null,
          elementSelectorsData: null
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
        genericProvider = new GenericProvider(args);
        await genericProvider.createDriver();
        let res = await genericProvider.screenshot('mock-name', {});
        expect(iOSGetTagSpy).toHaveBeenCalledTimes(1);
        expect(genericProvider.statusBarHeight).toEqual(132);
        expect(iOSGetTilesSpy).toHaveBeenCalledOnceWith(false);
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
          regions: null,
          algorithm: null,
          algorithmConfiguration: null,
          metadata: null,
          elementSelectorsData: null
        });
      });

      it('includes elementSelectorsData when boundingBoxes are provided', async () => {
        const tilesWithBoundingBoxes = {
          tiles: [{
            statusBarHeight: 132,
            sha: 'abc',
            navBarHeight: 0,
            headerHeight: 0,
            footerHeight: 0,
            fullscreen: false
          }],
          domInfoSha: 'mock-dom-sha',
          boundingBoxes: {
            '//*[@id="__next"]/div/div': {
              success: true,
              top: 0,
              left: 0,
              bottom: 1688.0625,
              right: 1280,
              message: 'Found',
              stacktrace: null
            }
          }
        };
        iOSGetTilesSpy.and.returnValue(Promise.resolve(tilesWithBoundingBoxes));
        genericProvider = new GenericProvider(args);
        await genericProvider.createDriver();
        let res = await genericProvider.screenshot('mock-name', {});

        expect(res.elementSelectorsData).toEqual({
          '//*[@id="__next"]/div/div': {
            success: true,
            top: 0,
            left: 0,
            bottom: 1688.0625,
            right: 1280,
            message: 'Found',
            stacktrace: null
          }
        });
      });
    });
  });

  describe('getWindowHeight', () => {
    beforeEach(() => {
      spyOn(Driver.prototype, 'executeScript').and.returnValue(Promise.resolve(true));
    });

    it('should call executeScript to get windowHeight', async () => {
      genericProvider = new GenericProvider(args);
      await genericProvider.createDriver();
      await genericProvider.getWindowHeight();
      expect(genericProvider.driver.executeScript).toHaveBeenCalledTimes(1);
      expect(genericProvider.driver.executeScript).toHaveBeenCalledWith({ script: 'return window.innerHeight', args: [] });
    });
  });

  describe('updatePageShiftFactor', () => {
    let provider;
    let scrollFactors;
    describe('When iOS singlepage screenshot', () => {
      beforeEach(async () => {
        provider = new GenericProvider(args);
        await provider.createDriver();
        scrollFactors = { value: [0, 10] };
        provider.currentTag = { osName: 'iOS' };
        provider.pageYShiftFactor = 0;
        provider.statusBarHeight = 0;
      });

      describe('when element is visible in viewport', () => {
        beforeEach(() => {
          provider.initialScrollLocation = { value: [0, 10] };
        });
        it('should update pageYShiftFactor for iOS when location.y is 0', async () => {
          await provider.updatePageShiftFactor({ y: 0 }, 2, scrollFactors);
          expect(provider.pageYShiftFactor).toBe(-20);
        });

        it('should not update pageYShiftFactor for iOS when location.y is not 0', async () => {
          // Location.y is not 0
          await provider.updatePageShiftFactor({ y: 5 }, 2, scrollFactors);
          expect(provider.pageYShiftFactor).toBe(0);
        });
      });

      describe('when element is not visible in viewport and iOS scrolls automatically', () => {
        beforeEach(() => {
          provider.initialScrollLocation = { value: [0, 30] };
        });
        it('should update pageYShiftFactor to negative value even if location.y is 0', async () => {
          await provider.updatePageShiftFactor({ y: 0 }, 2, scrollFactors);
          expect(provider.pageYShiftFactor).toBe(-50000);
        });

        it('should update pageYShiftFactor to negative value even if location.y is not 0', async () => {
          // Location.y is not 0
          await provider.updatePageShiftFactor({ y: 5 }, 2, scrollFactors);
          expect(provider.pageYShiftFactor).toBe(-50000);
        });
      });
    });

    describe('When iOS fullpage screenshot', () => {
      let args = {
        sessionId: '123',
        commandExecutorUrl: 'http:executorUrl',
        capabilities: { platform: 'win' },
        sessionCapabilities: {},
        clientInfo: 'local-poc-poa',
        environmentInfo: 'staging-poc-poa',
        options: {}
      };
      beforeEach(async () => {
        args.options = { fullPage: true };
        provider = new GenericProvider(args);
        await provider.createDriver();
        scrollFactors = { value: [0, 10] };
        provider.currentTag = { osName: 'iOS' };
        provider.pageYShiftFactor = 0;
      });

      describe('when element is present in DOM', () => {
        beforeEach(() => {
          provider.statusBarHeight = 10;
        });
        it('should update pageYShiftFactor for iOS to statusBarHeight', async () => {
          await provider.updatePageShiftFactor({ y: 0 }, 2, scrollFactors);
          expect(provider.pageYShiftFactor).toBe(10);
        });
      });
    });

    describe('When OS X singlepage', () => {
      beforeEach(async () => {
        args.capabilities = { platform: 'OS X' };
        provider = new GenericProvider(args);
        await provider.createDriver();
        scrollFactors = { value: [0, 10] };
        provider.currentTag = { osName: 'OS X' };
        provider.pageYShiftFactor = 0;
        provider.statusBarHeight = 0;
      });

      describe('When Safari browserVersion > 13', () => {
        describe('when element is visible in viewport', () => {
          beforeEach(() => {
            provider.initialScrollLocation = { value: [0, 10] };
            provider.currentTag.browserName = 'safari';
            provider.currentTag.browserVersion = 15;
          });

          it('should not update pageYShiftFactor for OS X if scrolled', async () => {
            await provider.updatePageShiftFactor({ y: 0 }, 1, scrollFactors);
            expect(provider.pageYShiftFactor).toBe(0);
          });
        });
      });

      describe('When Safari browserVersion <= 13', () => {
        describe('when element is visible in viewport', () => {
          beforeEach(() => {
            provider.initialScrollLocation = { value: [0, 10] };
            provider.currentTag.browserName = 'safari';
            provider.currentTag.browserVersion = 13;
          });

          it('should update pageYShiftFactor for OS X platforms accordingly if scrolled', async () => {
            await provider.updatePageShiftFactor({ y: 0 }, 1, scrollFactors);
            expect(provider.pageYShiftFactor).toBe(-10);
          });
        });
      });
    });

    describe('When OS X fullpage screenshot', () => {
      beforeEach(async () => {
        args.capabilities = { platform: 'OS X' };
        args.options = { fullPage: true };
        provider = new GenericProvider(args);
        await provider.createDriver();
        scrollFactors = { value: [0, 10] };
        provider.currentTag = { osName: 'OS X' };
        provider.pageYShiftFactor = 0;
      });

      describe('When Safari browserVersion > 13', () => {
        describe('when element is present in DOM', () => {
          beforeEach(() => {
            provider.currentTag.browserName = 'safari';
            provider.currentTag.browserVersion = 15;
            provider.statusBarHeight = 0;
          });

          it('should update pageYShiftFactor for OS X to statusBarHeight', async () => {
            await provider.updatePageShiftFactor({ y: 0 }, 1, scrollFactors);
            expect(provider.pageYShiftFactor).toBe(0);
          });
        });
      });

      describe('When Safari browserVersion <= 13', () => {
        describe('when element is present in DOM', () => {
          beforeEach(() => {
            provider.currentTag.browserName = 'safari';
            provider.currentTag.browserVersion = 13;
            provider.statusBarHeight = 20;
          });

          it('should update pageYShiftFactor for OS X platforms accordingly if scrolled', async () => {
            scrollFactors = { value: [0, 10] };
            await provider.updatePageShiftFactor({ y: 0 }, 1, scrollFactors);
            expect(provider.pageYShiftFactor).toBe(10);
          });
        });
      });
    });

    describe('When Other singlepage', () => {
      beforeEach(async () => {
        provider = new GenericProvider(args);
        await provider.createDriver();
        provider.currentTag = { osName: 'Android' };
        provider.pageYShiftFactor = 0;
      });

      it('should not update pageYShiftFactor for non-iOS platforms', async () => {
        scrollFactors = { value: [0, 0] };
        await provider.updatePageShiftFactor({ y: 0 }, 1, scrollFactors);
        expect(provider.pageYShiftFactor).toBe(0);
      });

      it('should update pageYShiftFactor for non-iOS platforms accordingly if scrolled', async () => {
        scrollFactors = { value: [0, 10] };
        await provider.updatePageShiftFactor({ y: 0 }, 1, scrollFactors);
        expect(provider.pageYShiftFactor).toBe(-10);
      });
    });

    describe('When Other fullpage', () => {
      beforeEach(async () => {
        args.options = { fullPage: true };
        provider = new GenericProvider(args);
        await provider.createDriver();
        provider.currentTag = { osName: 'Android' };
        provider.pageYShiftFactor = 0;
        provider.statusBarHeight = 0;
      });

      it('should update pageYShiftFactor for non-iOS platforms accordingly if scrolled', async () => {
        scrollFactors = { value: [0, 10] };
        await provider.updatePageShiftFactor({ y: 0 }, 1, scrollFactors);
        expect(provider.pageYShiftFactor).toBe(-10);
      });
    });
  });

  describe('getRegionObject', () => {
    let provider;
    let mockLocation = { x: 10, y: 20, width: 100, height: 200 };
    let scrollFactors = { value: [0, 0] };

    function expectRegionObject(scrollX, scrollY) {
      it('should return a JSON object with the correct selector and coordinates for tile', async () => {
        // Call function with mock data
        const selector = 'mock-selector';
        const result = await provider.getRegionObject(selector, 'mockElementId');

        // Assert expected result
        expect(result.selector).toEqual(selector);
        expect(result.coOrdinates).toEqual({
          top: mockLocation.y + scrollY + provider.pageYShiftFactor,
          bottom: mockLocation.y + mockLocation.height + scrollY + provider.pageYShiftFactor,
          left: mockLocation.x + scrollX + provider.pageXShiftFactor,
          right: mockLocation.x + mockLocation.width + scrollX + provider.pageXShiftFactor
        });
      });
    }
    describe('When singlepage screenshot', () => {
      beforeEach(async () => {
        // mock metadata
        provider = new GenericProvider(args);
        provider.currentTag = { osName: 'Windows' };
        await provider.createDriver();
        spyOn(DesktopMetaData.prototype, 'devicePixelRatio')
          .and.returnValue(1);
        spyOn(GenericProvider.prototype, 'getScrollDetails')
          .and.returnValue(scrollFactors);
        spyOn(Driver.prototype, 'rect').and.returnValue(Promise.resolve(mockLocation));
      });

      describe('When on Tile 0', () => {
        expectRegionObject(0, 0);
      });

      describe('When on Tile 1', () => {
        beforeEach(async () => {
          // mock metadata
          provider.currentTag = { osName: 'iOS' };
          provider.pageYShiftFactor = -10;
          provider.initialScrollLocation = scrollFactors;
        });
        expectRegionObject(0, 0);
      });
    });

    describe('When fullpage screenshot', () => {
      beforeEach(async () => {
        // mock metadata
        args.options = { fullPage: true };
        provider = new GenericProvider(args);
        provider.currentTag = { osName: 'Windows' };
        await provider.createDriver();
        spyOn(DesktopMetaData.prototype, 'devicePixelRatio')
          .and.returnValue(1);
        spyOn(Driver.prototype, 'executeScript')
          .and.returnValue({ value: [0, 0] });
        spyOn(Driver.prototype, 'rect').and.returnValue(Promise.resolve(mockLocation));
      });

      describe('When no scroll', () => {
        expectRegionObject(0, 0);
      });

      describe('When there is a scroll', () => {
        let scrollX = 10;
        let scrollY = 20;
        beforeEach(async () => {
          // mock metadata
          provider.currentTag = { osName: 'iOS' };
          spyOn(GenericProvider.prototype, 'getScrollDetails')
            .and.returnValue({ value: [scrollX, scrollY] });
          provider.pageYShiftFactor = -10;
        });
        expectRegionObject(scrollX, scrollY);
      });
    });
  });

  describe('getRegionObjectFromBoundingBox', () => {
    let provider;
    let mockLocation = { x: 10, y: 20, width: 100, height: 200 };
    beforeEach(async () => {
      // mock metadata
      provider = new GenericProvider(args);
      provider.currentTag = { osName: 'Windows' };
      await provider.createDriver();
      spyOn(DesktopMetaData.prototype, 'devicePixelRatio')
        .and.returnValue(1);
      provider.statusBarHeight = 0;
    });

    function expectRegionObjectFromBoundingBox(scrollX, scrollY) {
      // Call function with mock data
      it('should return a JSON object with the correct selector and coordinates', async () => {
        const selector = 'mock-selector';
        const result = await provider.getRegionObjectFromBoundingBox(selector, mockLocation);
        // Assert expected result
        expect(result.selector).toEqual(selector);
        expect(result.coOrdinates).toEqual({
          top: mockLocation.y + scrollY + provider.statusBarHeight,
          bottom: mockLocation.y + mockLocation.height + scrollY + provider.statusBarHeight,
          left: mockLocation.x + scrollX,
          right: mockLocation.x + mockLocation.width + scrollX
        });
      });
    }

    describe('When singlepage screenshot', () => {
      describe('When not an iOS', () => {
        expectRegionObjectFromBoundingBox(0, 0);
      });

      describe('When iOS', () => {
        beforeEach(() => {
          provider.currentTag = { osName: 'iOS' };
          provider.statusBarHeight = 132;
        });

        expectRegionObjectFromBoundingBox(0, 0);
      });
    });

    describe('When fullpage screenshot', () => {
      let scrollX = 10;
      let scrollY = 20;
      beforeEach(async () => {
        // mock metadata
        args.options = { fullPage: true };
        provider = new GenericProvider(args);
        provider.currentTag = { osName: 'Windows' };
        await provider.createDriver();
        provider.initialScrollLocation = { value: [scrollX, scrollY] };
      });

      describe('When not an iOS', () => {
        expectRegionObjectFromBoundingBox(scrollX, scrollY);
      });

      describe('When iOS', () => {
        beforeEach(() => {
          provider.currentTag = { osName: 'iOS' };
          provider.statusBarHeight = 132;
        });
        expectRegionObjectFromBoundingBox(scrollX, scrollY);
      });
    });
  });

  describe('getSeleniumRegionsByXpaths', () => {
    let getRegionObjectSpy;
    let provider;
    let xpathResponse = { top: 0, bottom: 500, right: 0, left: 300 };

    beforeEach(async () => {
      provider = new GenericProvider(args);
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
      provider = new GenericProvider(args);
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

  describe('scrollToPosition', () => {
    let provider;
    let executeScriptSpy;
    beforeEach(async () => {
      provider = new GenericProvider(args);
      provider.currentTag = { osName: 'Windows' };
      await provider.createDriver();
      executeScriptSpy = spyOn(Driver.prototype, 'executeScript');
    });

    it('should scroll to correct position', async () => {
      await provider.scrollToPosition(10, 20);
      expect(executeScriptSpy).toHaveBeenCalledWith({ script: 'window.scrollTo(10, 20)', args: [] });
    });
  });

  describe('isIOS', () => {
    let provider;
    beforeEach(async () => {
      provider = new GenericProvider(args);
      provider.currentTag = { osName: 'Windows' };
    });

    it('when not iOS returns false', async () => {
      let result = provider.isIOS();
      expect(result).toEqual(false);
    });

    it('when iOS returns true', async () => {
      provider.currentTag = { osName: 'iOS' };
      let result = provider.isIOS();
      expect(result).toEqual(true);
    });
  });

  describe('getSeleniumRegionsByElement', () => {
    let getRegionObjectSpy;
    let scrollToPositionSpy;
    let provider;
    const elements = ['mockElement_1', 'mockElement_2', 'mockElement_3'];

    beforeEach(async () => {
      provider = new GenericProvider(args);
      await provider.createDriver();
      getRegionObjectSpy = spyOn(GenericProvider.prototype, 'getRegionObject').and.returnValue({});
      scrollToPositionSpy = spyOn(GenericProvider.prototype, 'scrollToPosition');
    });

    it('should add regions for each element', async () => {
      const elementsArray = await provider.getSeleniumRegionsByElement(elements);
      expect(getRegionObjectSpy).toHaveBeenCalledTimes(3);
      expect(elementsArray).toEqual([{}, {}, {}]);
    });

    it('should ignore when error', async () => {
      getRegionObjectSpy.and.rejectWith(new Error('Element not found'));

      const elementsArray = await provider.getSeleniumRegionsByElement(elements);

      expect(elementsArray).toEqual([]);
    });

    it('should not scroll back to initial position for non iOS', async () => {
      await provider.getSeleniumRegionsByElement(elements);
      expect(scrollToPositionSpy).not.toHaveBeenCalled();
    });

    it('should scroll back to initial position for iOS', async () => {
      provider.currentTag = { osName: 'iOS' };
      provider.initialScrollLocation = { value: [10, 20] };
      await provider.getSeleniumRegionsByElement(elements);
      expect(scrollToPositionSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('getSeleniumRegionsByLocation', () => {
    let provider;

    beforeEach(async () => {
      provider = new GenericProvider(args);
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
      provider = new GenericProvider(args);
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
    let getInitialScrollLocationSpy;

    beforeEach(async () => {
      provider = new GenericProvider(args);
      await provider.createDriver();
      executeScriptSpy = spyOn(Driver.prototype, 'executeScript');
      getInitialScrollLocationSpy = spyOn(GenericProvider.prototype, 'getInitialScrollLocation');
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

    it('should not get initial scroll position for singlepage for non ios', async () => {
      await provider.doTransformations();
      expect(getInitialScrollLocationSpy).not.toHaveBeenCalled();
    });

    it('should get initial scroll position for singlepage for ios', async () => {
      provider.currentTag = { osName: 'iOS' };
      await provider.createDriver();
      await provider.doTransformations();
      expect(getInitialScrollLocationSpy).toHaveBeenCalled();
    });

    it('should get initial scroll position for singlepage', async () => {
      args.options = { fullPage: true };
      provider = new GenericProvider(args);
      await provider.createDriver();
      await provider.doTransformations();
      expect(getInitialScrollLocationSpy).toHaveBeenCalled();
    });
  });

  describe('undoTransformations', () => {
    let provider;
    let executeScriptSpy;

    beforeEach(async () => {
      provider = new GenericProvider(args);
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

  describe('getScrollDetails', () => {
    let provider;
    let executeScriptSpy;

    beforeEach(async () => {
      provider = new GenericProvider(args);
      await provider.createDriver();
      executeScriptSpy = spyOn(Driver.prototype, 'executeScript');
    });

    it('should return scroll params', async () => {
      await provider.getScrollDetails();
      expect(executeScriptSpy).toHaveBeenCalledWith({ script: 'return [parseInt(window.scrollX), parseInt(window.scrollY)];', args: [] });
    });
  });

  describe('getInitialScrollLocation', () => {
    let provider;
    let getScrollDetailsSpy;

    beforeEach(async () => {
      provider = new GenericProvider(args);
      await provider.createDriver();
      getScrollDetailsSpy = spyOn(GenericProvider.prototype, 'getScrollDetails');
      provider.initialScrollLocation = { value: [1, 1] };
    });

    it('do not get scroll details if already present', async () => {
      provider.getInitialScrollLocation();
      expect(getScrollDetailsSpy).not.toHaveBeenCalled();
    });
    it('gets scroll details if not present', async () => {
      provider.initialScrollLocation = null;
      provider.getInitialScrollLocation();
      expect(getScrollDetailsSpy).toHaveBeenCalled();
    });
  });

  describe('getUserAgentString', () => {
    let provider = new GenericProvider(args);
    it('should return empty string if input is not a Set or string', () => {
      expect(provider.getUserAgentString(123)).toEqual('');
      expect(provider.getUserAgentString(null)).toEqual('');
      expect(provider.getUserAgentString(undefined)).toEqual('');
      expect(provider.getUserAgentString([])).toEqual('');
      expect(provider.getUserAgentString({})).toEqual('');
    });

    it('should return stringified Set elements separated by semicolon', () => {
      const data = new Set(['Mozilla/5.0', 'AppleWebKit/537.36', 'Chrome/64.0.3282.140']);
      expect(provider.getUserAgentString(data)).toEqual('Mozilla/5.0; AppleWebKit/537.36; Chrome/64.0.3282.140');
    });

    it('should return the same string if input is a string', () => {
      const data = 'Mozilla/5.0; AppleWebKit/537.36; Chrome/64.0.3282.140';
      expect(provider.getUserAgentString(data)).toEqual(data);
    });

    it('should return empty string for empty Set', () => {
      const data = new Set();
      expect(provider.getUserAgentString(data)).toEqual('');
    });
  });

  describe('browserstackExecutor', () => {
    let executeScriptSpy;

    beforeEach(async () => {
      executeScriptSpy = spyOn(Driver.prototype, 'executeScript');
    });

    it('throws Error when called without initializing driver', async () => {
      let provider = new GenericProvider(args);
      await expectAsync(provider.browserstackExecutor('getSessionDetails'))
        .toBeRejectedWithError('Driver is null, please initialize driver with createDriver().');
    });

    it('calls browserstackExecutor with correct arguments for actions only', async () => {
      let provider = new GenericProvider(args);
      await provider.createDriver();
      await provider.browserstackExecutor('getSessionDetails');
      expect(executeScriptSpy)
        .toHaveBeenCalledWith({ script: 'browserstack_executor: {"action":"getSessionDetails"}', args: [] });
    });

    it('calls browserstackExecutor with correct arguments for actions + args', async () => {
      let provider = new GenericProvider(args);
      await provider.createDriver();
      await provider.browserstackExecutor('getSessionDetails', 'new');
      expect(executeScriptSpy)
        .toHaveBeenCalledWith({ script: 'browserstack_executor: {"action":"getSessionDetails","arguments":"new"}', args: [] });
    });
  });

  describe('getTag', () => {
    it('throws Error when automate results is null', async () => {
      let provider = new GenericProvider(args);
      provider.automateResults = null;
      const error = new Error('Comparison tag details not available');
      await expectAsync(
        provider.getTag({ width: 100, height: 100, resolution: 'resolution' })
      ).toBeRejectedWith(error);
    });
  });
});
