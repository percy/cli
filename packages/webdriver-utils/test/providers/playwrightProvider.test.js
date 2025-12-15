import PlaywrightProvider from '../../src/providers/playwrightProvider.js';
import GenericProvider from '../../src/providers/genericProvider.js';
import Tile from '../../src/util/tile.js';
import NormalizeData from '../../src/metadata/normalizeData.js';

describe('PlaywrightProvider', () => {
  let provider;

  beforeEach(async () => {
    provider = new PlaywrightProvider(
      'sessionId',
      'frameGuid',
      'pageGuid',
      'clientInfo',
      'environmentInfo',
      'options',
      { id: 1 }
    );
  });

  describe('constructor', () => {
    it('should initialize the PlaywrightProvider with the provided parameters', () => {
      expect(provider.sessionId).toBe('sessionId');
      expect(provider.frameGuid).toBe('frameGuid');
      expect(provider.pageGuid).toBe('pageGuid');
      expect(provider.clientInfo).toBe('clientInfo');
      expect(provider.environmentInfo).toBe('environmentInfo');
      expect(provider.options).toBe('options');
      expect(provider.buildInfo).toEqual({ id: 1 });
    });
  });

  describe('createDriver', () => {
    it('should create a new PlaywrightDriver', async () => {
      await provider.createDriver();
      expect(provider.driver).toBeDefined();
      expect(provider.driver.sessionId).toEqual('sessionId');
    });
  });

  describe('setDebugUrl', () => {
    it('should set the debugUrl property with the correct value', async () => {
      provider.automateResults = {
        buildHash: 'buildHash',
        sessionHash: 'sessionHash'
      };
      await provider.setDebugUrl();
      expect(provider.debugUrl).toBe(
        'https://automate.browserstack.com/builds/buildHash/sessions/sessionHash'
      );
    });
  });

  describe('screenshot', () => {
    // Mock the percyScreenshotBegin and percyScreenshotEnd methods
    const percyScreenshotBeginMock = jasmine
      .createSpy('percyScreenshotBegin')
      .and.returnValue(
        Promise.resolve({
          value: JSON.stringify({
            buildHash: 'buildHash',
            sessionHash: 'sessionHash'
          })
        })
      );
    const percyScreenshotEndMock = jasmine
      .createSpy('percyScreenshotEnd')
      .and.returnValue(Promise.resolve());

    beforeEach(() => {
      // Replace the original methods with the mocks in the prototype of the parent class
      spyOn(GenericProvider.prototype, 'percyScreenshotBegin').and.callFake(
        percyScreenshotBeginMock
      );
      spyOn(GenericProvider.prototype, 'percyScreenshotEnd').and.callFake(
        percyScreenshotEndMock
      );
      // Mock the response for getTiles
      provider.getTiles = jasmine.createSpy('getTiles').and.resolveTo({
        tiles: [],
        domInfoSha: 'domInfoSha',
        tagData: { width: 100, height: 100, resolution: 'resolution' },
        ignoreRegionsData: [],
        considerRegionsData: [],
        metadata: null
      });
      // Mock the response for getTag
      provider.getTag = jasmine.createSpy('getTag').and.returnValue({
        name: 'deviceName',
        osName: 'osName',
        osVersion: 'osVersion',
        width: 100,
        height: 100,
        orientation: 'orientation',
        browserName: 'browserName',
        browserVersion: 'browserVersion',
        resolution: 'resolution'
      });
    });

    afterEach(() => {
      percyScreenshotBeginMock.calls.reset();
      percyScreenshotEndMock.calls.reset();
    });

    it('should capture screenshots successfully', async () => {
      const response = await provider.screenshot('name', {});
      expect(percyScreenshotBeginMock).toHaveBeenCalledWith('name');
      expect(provider.automateResults).toEqual({
        buildHash: 'buildHash',
        sessionHash: 'sessionHash'
      });
      expect(provider.debugUrl).toBe(
        'https://automate.browserstack.com/builds/buildHash/sessions/sessionHash'
      );
      expect(provider.getTiles).toHaveBeenCalled();
      expect(provider.getTag).toHaveBeenCalled();
      expect(response).toEqual({
        name: 'name',
        tag: {
          name: 'deviceName',
          osName: 'osName',
          osVersion: 'osVersion',
          width: 100,
          height: 100,
          orientation: 'orientation',
          browserName: 'browserName',
          browserVersion: 'browserVersion',
          resolution: 'resolution'
        },
        tiles: [],
        externalDebugUrl:
          'https://automate.browserstack.com/builds/buildHash/sessions/sessionHash',
        ignoredElementsData: { ignoreElementsData: [] },
        consideredElementsData: { considerElementsData: [] },
        environmentInfo: 'environmentInfo',
        clientInfo: 'clientInfo',
        domInfoSha: 'domInfoSha',
        regions: null,
        algorithm: null,
        algorithmConfiguration: null,
        metadata: null
      });
    });

    it('should handle errors during screenshot capture', async () => {
      const error = new Error('Failed to capture screenshots');
      provider.getTiles.and.rejectWith(error);
      await expectAsync(provider.screenshot('name', {})).toBeRejectedWith(
        error
      );
      expect(percyScreenshotEndMock).toHaveBeenCalledWith('name', error);
    });
  });

  describe('getTiles', () => {
    it('should capture tiles successfully for singlepage screenshot', async () => {
      provider.browserstackExecutor = jasmine
        .createSpy('browserstackExecutor')
        .and.resolveTo({
          value: JSON.stringify({
            success: true,
            result: JSON.stringify({
              tiles: [
                {
                  status_bar: 20,
                  nav_bar: 30,
                  header_height: 40,
                  footer_height: 50,
                  sha: 'tile1'
                }
              ],
              comparison_tag_data: {
                width: 100,
                height: 100,
                resolution: 'resolution'
              },
              ignore_regions_data: [{ x: 10, y: 20, width: 30, height: 40 }],
              consider_regions_data: [{ x: 50, y: 60, width: 70, height: 80 }],
              dom_sha: 'domSHA'
            })
          })
        });

      const response = await provider.getTiles(false);
      expect(provider.browserstackExecutor).toHaveBeenCalledWith(
        'percyScreenshot',
        {
          state: 'screenshot',
          percyBuildId: 1,
          screenshotType: 'singlepage',
          scaleFactor: 1,
          options: 'options',
          frameworkData: { frameGuid: 'frameGuid', pageGuid: 'pageGuid' },
          framework: 'playwright'
        }
      );
      expect(response).toEqual({
        tiles: [
          new Tile({
            statusBarHeight: 20,
            navBarHeight: 30,
            headerHeight: 40,
            footerHeight: 50,
            fullscreen: false,
            sha: 'tile1'
          })
        ],
        domInfoSha: 'domSHA',
        tagData: { width: 100, height: 100, resolution: 'resolution' },
        ignoreRegionsData: [{ x: 10, y: 20, width: 30, height: 40 }],
        considerRegionsData: [{ x: 50, y: 60, width: 70, height: 80 }],
        metadata: { screenshotType: 'singlepage' }
      });
    });

    it('should capture tiles successfully with default values for singlepage screenshot', async () => {
      provider.browserstackExecutor = jasmine
        .createSpy('browserstackExecutor')
        .and.resolveTo({
          value: JSON.stringify({
            success: true,
            result: JSON.stringify({
              tiles: [
                {
                  sha: 'tile1'
                }
              ],
              comparison_tag_data: {
                width: 100,
                height: 100,
                resolution: 'resolution'
              },
              dom_sha: 'domSHA'
            })
          })
        });

      const response = await provider.getTiles(false);
      expect(provider.browserstackExecutor).toHaveBeenCalledWith(
        'percyScreenshot',
        {
          state: 'screenshot',
          percyBuildId: 1,
          screenshotType: 'singlepage',
          scaleFactor: 1,
          options: 'options',
          frameworkData: { frameGuid: 'frameGuid', pageGuid: 'pageGuid' },
          framework: 'playwright'
        }
      );
      expect(response).toEqual({
        tiles: [
          new Tile({
            statusBarHeight: 0,
            navBarHeight: 0,
            headerHeight: 0,
            footerHeight: 0,
            fullscreen: false,
            sha: 'tile1'
          })
        ],
        domInfoSha: 'domSHA',
        tagData: { width: 100, height: 100, resolution: 'resolution' },
        ignoreRegionsData: [],
        considerRegionsData: [],
        metadata: { screenshotType: 'singlepage' }
      });
    });

    it('should capture tiles successfully for fullscreen screenshot', async () => {
      provider = new PlaywrightProvider(
        'sessionId',
        'frameGuid',
        'pageGuid',
        'clientInfo',
        'environmentInfo',
        { fullPage: true },
        { id: 1 }
      );
      provider.browserstackExecutor = jasmine
        .createSpy('browserstackExecutor')
        .and.resolveTo({
          value: JSON.stringify({
            success: true,
            result: JSON.stringify({
              tiles: [
                {
                  status_bar: 20,
                  nav_bar: 30,
                  header_height: 40,
                  footer_height: 50,
                  sha: 'tile1'
                },
                {
                  status_bar: 10,
                  nav_bar: 20,
                  header_height: 30,
                  footer_height: 40,
                  sha: 'tile2'
                }
              ],
              comparison_tag_data: {
                width: 200,
                height: 200,
                resolution: 'resolution'
              },
              ignore_regions_data: [{ x: 10, y: 20, width: 30, height: 40 }],
              consider_regions_data: [{ x: 50, y: 60, width: 70, height: 80 }],
              dom_sha: 'domSHA'
            })
          })
        });

      const response = await provider.getTiles(true);
      expect(provider.browserstackExecutor).toHaveBeenCalledWith(
        'percyScreenshot',
        {
          state: 'screenshot',
          percyBuildId: 1,
          screenshotType: 'fullpage',
          scaleFactor: 1,
          options: { fullPage: true },
          frameworkData: { frameGuid: 'frameGuid', pageGuid: 'pageGuid' },
          framework: 'playwright'
        }
      );
      expect(response).toEqual({
        tiles: [
          new Tile({
            statusBarHeight: 20,
            navBarHeight: 30,
            headerHeight: 40,
            footerHeight: 50,
            fullscreen: true,
            sha: 'tile1'
          }),
          new Tile({
            statusBarHeight: 10,
            navBarHeight: 20,
            headerHeight: 30,
            footerHeight: 40,
            fullscreen: true,
            sha: 'tile2'
          })
        ],
        domInfoSha: 'domSHA',
        tagData: { width: 200, height: 200, resolution: 'resolution' },
        ignoreRegionsData: [{ x: 10, y: 20, width: 30, height: 40 }],
        considerRegionsData: [{ x: 50, y: 60, width: 70, height: 80 }],
        metadata: { screenshotType: 'fullpage' }
      });
    });

    it('should handle errors during tile capture', async () => {
      const error = new Error('Failed to capture tiles');
      provider.browserstackExecutor = jasmine
        .createSpy('browserstackExecutor')
        .and.rejectWith(error);
      await expectAsync(provider.getTiles()).toBeRejectedWith(error);
    });

    it('should handle errors if response is not success', async () => {
      const error = new Error(
        'Failed to get screenshots from Automate.' +
          ' Check dashboard for error.'
      );
      provider.browserstackExecutor = jasmine
        .createSpy('browserstackExecutor')
        .and.resolveTo({
          value: JSON.stringify({ success: false, result: {} })
        });
      await expectAsync(provider.getTiles()).toBeRejectedWith(error);
    });
  });

  describe('getTag', () => {
    it('should return the tag details', async () => {
      spyOn(NormalizeData.prototype, 'osRollUp').and.returnValue('Windows');
      spyOn(NormalizeData.prototype, 'browserRollUp').and.returnValue('Chrome');
      spyOn(
        NormalizeData.prototype,
        'browserVersionOrDeviceNameRollup'
      ).and.returnValue('90.0');
      provider.automateResults = {
        capabilities: {
          deviceName: 'deviceName',
          os: 'os',
          os_version: '11.0',
          browserName: 'browserName',
          browserVersion: 'browserVersion',
          deviceOrientation: 'orientation'
        }
      };
      const response = await provider.getTag({
        width: 100,
        height: 100,
        resolution: 'resolution'
      });
      expect(response).toEqual({
        name: 'Windows_11_Chrome_90.0',
        osName: 'Windows',
        osVersion: '11',
        width: 100,
        height: 100,
        orientation: 'orientation',
        browserName: 'Chrome',
        browserVersion: '90.0',
        resolution: 'resolution',
        percyBrowserCustomName: null
      });
    });

    it('should return the correct tag details for android', async () => {
      spyOn(NormalizeData.prototype, 'osRollUp').and.returnValue('ANDROID');
      spyOn(NormalizeData.prototype, 'browserRollUp').and.returnValue('Chrome');
      spyOn(
        NormalizeData.prototype,
        'browserVersionOrDeviceNameRollup'
      ).and.returnValue('90.0');
      provider.automateResults = {
        deviceName: 'deviceName',
        capabilities: {
          os: 'os',
          os_version: '11.0',
          browserName: 'browserName',
          browserVersion: 'browserVersion'
        }
      };
      const response = await provider.getTag({
        width: 100,
        height: 100,
        resolution: 'resolution'
      });

      expect(NormalizeData.prototype.browserRollUp).toHaveBeenCalledWith('browserName', true);
      expect(response).toEqual({
        name: 'deviceName',
        osName: 'ANDROID',
        osVersion: '11',
        width: 100,
        height: 100,
        orientation: 'landscape',
        browserName: 'Chrome',
        browserVersion: '90.0',
        resolution: 'resolution',
        percyBrowserCustomName: null
      });
    });
    it('should return the correct tag details for ios', async () => {
      spyOn(NormalizeData.prototype, 'osRollUp').and.returnValue('IOS');
      spyOn(NormalizeData.prototype, 'browserRollUp').and.returnValue('Safari');
      spyOn(
        NormalizeData.prototype,
        'browserVersionOrDeviceNameRollup'
      ).and.returnValue('iPhone 12');
      provider.automateResults = {
        deviceName: 'iPhone 12',
        capabilities: {
          os: 'ios',
          os_version: '14.0',
          browserName: 'Safari',
          browserVersion: '14.0'
        }
      };
      const response = await provider.getTag({
        width: 375,
        height: 812,
        resolution: '375x812'
      });

      expect(NormalizeData.prototype.browserRollUp).toHaveBeenCalledWith('Safari', true);
      expect(response).toEqual({
        name: 'iPhone 12',
        osName: 'IOS',
        osVersion: '14',
        width: 375,
        height: 812,
        orientation: 'landscape',
        browserName: 'Safari',
        browserVersion: 'iPhone 12',
        resolution: '375x812',
        percyBrowserCustomName: null
      });
    });

    it('should throw an error if automateResults is not available', async () => {
      provider.automateResults = null;
      const error = new Error('Comparison tag details not available');
      await expectAsync(
        provider.getTag({ width: 100, height: 100, resolution: 'resolution' })
      ).toBeRejectedWith(error);
    });
  });
});
