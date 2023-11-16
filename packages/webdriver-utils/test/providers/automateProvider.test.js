import Driver from '../../src/driver.js';
import GenericProvider from '../../src/providers/genericProvider.js';
import AutomateProvider from '../../src/providers/automateProvider.js';
import DesktopMetaData from '../../src/metadata/desktopMetaData.js';
import Tile from '../../src/util/tile.js';
import MobileMetaData from '../../src/metadata/mobileMetaData.js';
import Cache from '../../src/util/cache.js';

describe('AutomateProvider', () => {
  let superScreenshotSpy;

  beforeEach(async () => {
    superScreenshotSpy = spyOn(GenericProvider.prototype, 'screenshot');
  });

  afterEach(() => {
    superScreenshotSpy.calls.reset();
  });

  describe('browserstackExecutor', () => {
    let executeScriptSpy;
    let percyBuildInfo = {
      id: '123',
      url: 'https://percy.io/abc/123'
    };

    beforeEach(async () => {
      executeScriptSpy = spyOn(Driver.prototype, 'executeScript');
      spyOn(Driver.prototype, 'getCapabilites');
    });

    it('throws Error when called without initializing driver', async () => {
      let automateProvider = new AutomateProvider('1234', 'https://localhost/command-executor', { platform: 'win' }, {}, 'client', 'environment', {}, percyBuildInfo);
      await expectAsync(automateProvider.browserstackExecutor('getSessionDetails'))
        .toBeRejectedWithError('Driver is null, please initialize driver with createDriver().');
    });

    it('calls browserstackExecutor with correct arguemnts for actions only', async () => {
      let automateProvider = new AutomateProvider('1234', 'https://localhost/command-executor', { platform: 'win' }, {}, 'client', 'environment', {}, percyBuildInfo);
      await automateProvider.createDriver();
      await automateProvider.browserstackExecutor('getSessionDetails');
      expect(executeScriptSpy)
        .toHaveBeenCalledWith({ script: 'browserstack_executor: {"action":"getSessionDetails"}', args: [] });
    });

    it('calls browserstackExecutor with correct arguemnts for actions + args', async () => {
      let automateProvider = new AutomateProvider('1234', 'https://localhost/command-executor', { platform: 'win' }, {}, 'client', 'environment', {}, percyBuildInfo);
      await automateProvider.createDriver();
      await automateProvider.browserstackExecutor('getSessionDetails', 'new');
      expect(executeScriptSpy)
        .toHaveBeenCalledWith({ script: 'browserstack_executor: {"action":"getSessionDetails","arguments":"new"}', args: [] });
    });
  });

  describe('setDebugUrl', () => {
    let percyScreenshotBeginSpy;
    let percyBuildInfo = {
      id: '123',
      url: 'https://percy.io/abc/123'
    };

    beforeEach(async () => {
      percyScreenshotBeginSpy = spyOn(AutomateProvider.prototype,
        'percyScreenshotBegin').and.returnValue(Promise.resolve({ value: '{"buildHash":"12e3","sessionHash":"abc1d"}' }));
      spyOn(Driver.prototype, 'getCapabilites');
    });

    it('sets automate url', async () => {
      let automateProvider = new AutomateProvider('1234', 'https://localhost/command-executor', { platform: 'win' }, {}, 'client', 'environment', {}, percyBuildInfo);
      await automateProvider.createDriver();
      await automateProvider.screenshot('abc', { });

      expect(percyScreenshotBeginSpy).toHaveBeenCalledWith('abc');
      expect(automateProvider.debugUrl).toEqual('https://automate.browserstack.com/builds/12e3/sessions/abc1d');
    });

    it('throws error if driver is not initialized', async () => {
      let automateProvider = new AutomateProvider('1234', 'https://localhost/command-executor', { platform: 'win' }, {}, 'client', 'environment', {}, percyBuildInfo);
      await expectAsync(automateProvider.setDebugUrl())
        .toBeRejectedWithError('Driver is null, please initialize driver with createDriver().');
    });
  });

  describe('supports', () => {
    it('returns true for browserstack automate', () => {
      expect(AutomateProvider.supports('http:browserstack')).toEqual(true);
    });

    it('returns false for outside automate', () => {
      expect(AutomateProvider.supports('http:outside')).toEqual(false);
    });
  });

  describe('screenshot', () => {
    let percyScreenshotBeginSpy;
    let percyScreenshotEndSpy;
    const options = {
      ignoreRegionXpaths: [],
      ignoreRegionSelectors: [],
      ignoreRegionElements: [],
      customIgnoreRegions: [],
      considerRegionXpaths: [],
      considerRegionSelectors: [],
      considerRegionElements: [],
      customConsiderRegions: []
    };
    let percyBuildInfo = {
      id: '123',
      url: 'https://percy.io/abc/123'
    };
    const automateProvider = new AutomateProvider('1234', 'https://localhost/command-executor', { platform: 'win' }, {}, 'client', 'environment', {}, percyBuildInfo);

    beforeEach(async () => {
      percyScreenshotBeginSpy = spyOn(AutomateProvider.prototype,
        'percyScreenshotBegin').and.returnValue({ value: '{"buildHash":"12e3","sessionHash":"abc1d"}' });
      percyScreenshotEndSpy = spyOn(AutomateProvider.prototype,
        'percyScreenshotEnd').and.returnValue(true);
      spyOn(Driver.prototype, 'getCapabilites');
    });

    it('test call with default args', async () => {
      await automateProvider.createDriver();
      superScreenshotSpy.and.resolveTo({ body: { link: 'link to screenshot' } });
      await automateProvider.screenshot('abc', { });

      expect(percyScreenshotBeginSpy).toHaveBeenCalledWith('abc');
      expect(superScreenshotSpy).toHaveBeenCalledWith('abc', options);
      expect(percyScreenshotEndSpy).toHaveBeenCalledWith('abc', undefined);
    });

    it('passes exception message to percyScreenshotEnd in case of exception', async () => {
      await automateProvider.createDriver();
      const errorObj = new Error('Some error occured');
      superScreenshotSpy.and.rejectWith(errorObj);
      percyScreenshotEndSpy.and.rejectWith(errorObj);
      await expectAsync(automateProvider.screenshot('abc', options)).toBeRejectedWith(errorObj);
      expect(percyScreenshotBeginSpy).toHaveBeenCalledWith('abc');
      expect(percyScreenshotEndSpy).toHaveBeenCalledWith('abc', errorObj);
    });
  });

  describe('percyScreenshotBegin', () => {
    let percyBuildInfo = {
      id: '123',
      url: 'https://percy.io/abc/123'
    };

    beforeEach(async () => {
      spyOn(Driver.prototype, 'getCapabilites');
    });

    it('throw error', async () => {
      const automateProvider = new AutomateProvider('1234', 'https://localhost/command-executor', { platform: 'win' }, {}, 'client', 'environment', {}, percyBuildInfo);
      await automateProvider.createDriver();
      spyOn(Driver.prototype, 'executeScript').and.returnValue(Promise.reject(new Error('Random network error')));
      await expectAsync(automateProvider.percyScreenshotBegin('abc')).toBeRejectedWithError('Random network error');
    });

    it('marks the percy session as success', async () => {
      const automateProvider = new AutomateProvider('1234', 'https://localhost/command-executor', { platform: 'win' }, {}, 'client', 'environment', {}, percyBuildInfo);
      await automateProvider.createDriver();
      spyOn(Driver.prototype, 'executeScript').and.returnValue(Promise.resolve({ success: true }));
      await automateProvider.percyScreenshotBegin('abc');
      expect(automateProvider._markedPercy).toBeTruthy();
    });

    it('throw error if statusCode:13', async () => {
      const automateProvider = new AutomateProvider('1234', 'https://localhost/command-executor', { platform: 'win' }, {}, {}, 'client', 'environment', {}, percyBuildInfo);
      await automateProvider.createDriver();
      spyOn(Driver.prototype, 'executeScript').and.returnValue(Promise.resolve({ status: 13, value: 'OS/Browser/Selenium combination is not supported' }));
      await expectAsync(automateProvider.percyScreenshotBegin('abc')).toBeRejectedWithError('OS/Browser/Selenium combination is not supported');
    });

    it('throw "Got invalid error resposne" if result.value does not exists', async () => {
      const automateProvider = new AutomateProvider('1234', 'https://localhost/command-executor', { platform: 'win' }, {}, {}, 'client', 'environment', {}, percyBuildInfo);
      await automateProvider.createDriver();
      spyOn(Driver.prototype, 'executeScript').and.returnValue(Promise.resolve({ status: 13 }));
      await expectAsync(automateProvider.percyScreenshotBegin('abc')).toBeRejectedWithError('Got invalid error response');
    });

    it('mark percy sesssion as failure', async () => {
      const automateProvider = new AutomateProvider('1234', 'https://localhost/command-executor', { platform: 'win' }, {}, {}, 'client', 'environment', {}, percyBuildInfo);
      await automateProvider.createDriver();
      // eslint-disable-next-line prefer-promise-reject-errors
      spyOn(Driver.prototype, 'executeScript').and.returnValue(Promise.reject({ response: { body: JSON.stringify({ value: { error: 'OS/Browser/Selenium combination is not supported', message: 'OS/Browser/Selenium combination is not supported' } }) } }));
      await expectAsync(automateProvider.percyScreenshotBegin('abc')).toBeRejectedWithError('OS/Browser/Selenium combination is not supported');
    });

    it('catch direct response error', async () => {
      const automateProvider = new AutomateProvider('1234', 'https://localhost/command-executor', { platform: 'win' }, {}, {}, 'client', 'environment', {}, percyBuildInfo);
      await automateProvider.createDriver();
      // eslint-disable-next-line prefer-promise-reject-errors
      spyOn(Driver.prototype, 'executeScript').and.returnValue(Promise.reject('Random Error'));
      await expectAsync(automateProvider.percyScreenshotBegin('abc')).toBeRejectedWithError('Random Error');
    });
  });

  describe('percyScreenshotEnd', () => {
    let percyBuildInfo = {
      id: '123',
      url: 'https://percy.io/abc/123'
    };

    let errorObj = new Error('Random network error');
    const automateProvider = new AutomateProvider('1234', 'https://localhost/command-executor', { platform: 'win' }, {}, 'client', 'environment', {}, percyBuildInfo);

    beforeEach(async () => {
      spyOn(Driver.prototype, 'getCapabilites');
    });

    it('supresses exception and does not throw', async () => {
      await automateProvider.createDriver();
      automateProvider.driver = jasmine.createSpy().and.rejectWith(errorObj);
      expect(async () => await automateProvider.percyScreenshotEnd('abc', errorObj)).not.toThrow();
    });

    it('marks status as failed if error is present', async () => {
      await automateProvider.createDriver();
      automateProvider.driver.executeScript = jasmine.createSpy().and.rejectWith(new Error('Random network error'));
      await automateProvider.percyScreenshotEnd('abc', errorObj);

      expect(automateProvider.driver.executeScript).toHaveBeenCalledWith(
        {
          script: `browserstack_executor: {"action":"percyScreenshot","arguments":{"name":"abc","percyScreenshotUrl":"${percyBuildInfo.url}","status":"failure","statusMessage":"${errorObj}","state":"end"}}`,
          args: []
        });
    });

    it('marks status as success if no error', async () => {
      await automateProvider.createDriver();
      automateProvider.driver.executeScript = jasmine.createSpy().and.resolveTo('success');
      await automateProvider.percyScreenshotEnd('abc', undefined);

      expect(automateProvider.driver.executeScript).toHaveBeenCalledWith(
        {
          script: `browserstack_executor: {"action":"percyScreenshot","arguments":{"name":"abc","percyScreenshotUrl":"${percyBuildInfo.url}","status":"success","statusMessage":"","state":"end"}}`,
          args: []
        });
    });
  });

  function tilesErrorResponseCheck(automateProvider) {
    it('throws error when response is false', async () => {
      await automateProvider.createDriver();
      let browserstackExecutorSpy = spyOn(AutomateProvider.prototype, 'browserstackExecutor');
      browserstackExecutorSpy.and.returnValue(Promise.resolve({ value: '{ "error": "Random Error", "success":false }' }));
      await expectAsync(automateProvider.getTiles(false)).toBeRejectedWithError('Failed to get screenshots from Automate.' +
        ' Check dashboard for error.');
    });

    it('throws error when driver is null', async () => {
      automateProvider.driver = null;
      await expectAsync(automateProvider.getTiles(false)).toBeRejectedWithError('Driver is null, please initialize driver with createDriver().');
    });
  }

  describe('getTiles', () => {
    let percyBuildInfo = {
      id: '123',
      url: 'https://percy.io/abc/123'
    };
    let browserstackExecutorSpy = null;
    let executeScriptSpy;

    describe('fullpage', () => {
      const automateProvider = new AutomateProvider('1234', 'https://localhost/command-executor', { platform: 'win' }, {}, 'client', 'environment', { fullPage: true }, percyBuildInfo);

      beforeEach(async () => {
        Cache.reset();
        spyOn(Driver.prototype, 'getCapabilites');
        executeScriptSpy = spyOn(Driver.prototype, 'executeScript')
          .and.returnValue(Promise.resolve(1));
      });

      it('should return tiles when success', async () => {
        browserstackExecutorSpy = spyOn(AutomateProvider.prototype, 'browserstackExecutor')
          .and.returnValue(Promise.resolve({ value: '{"success": true, "result": "{\\"tiles\\":[{\\"sha\\":\\"abc\\",\\"status_bar\\":0,\\"nav_bar\\":156,\\"header_height\\":0,\\"footer_height\\":156,\\"index\\":0},{\\"sha\\":\\"cde\\",\\"status_bar\\":0,\\"nav_bar\\":156,\\"header_height\\":0.0,\\"footer_height\\":156.0,\\"index\\":1}],\\"dom_sha\\":\\"def\\"}"}' }));
        await automateProvider.createDriver();
        const res = await automateProvider.getTiles(false);
        const expectedOutput = {
          tiles: [
            new Tile({
              statusBarHeight: 0,
              navBarHeight: 156,
              headerHeight: 0,
              footerHeight: 156,
              fullscreen: false,
              sha: 'abc'
            }),
            new Tile({
              statusBarHeight: 0,
              navBarHeight: 156,
              headerHeight: 0,
              footerHeight: 156,
              fullscreen: false,
              sha: 'cde'
            })
          ],
          domInfoSha: 'def',
          metadata: {}
        };
        expect(browserstackExecutorSpy).toHaveBeenCalledTimes(1);
        expect(executeScriptSpy).toHaveBeenCalledTimes(1);
        expect(res).toEqual(expectedOutput);
      });

      it('should return default values of header and footer if not in response', async () => {
        browserstackExecutorSpy = spyOn(AutomateProvider.prototype, 'browserstackExecutor')
          .and.returnValue(Promise.resolve({ value: '{"success": true, "result": "{\\"tiles\\":[{\\"sha\\":\\"abc\\",\\"index\\":0}],\\"dom_sha\\":\\"def\\"}"}' }));
        await automateProvider.createDriver();
        const res = await automateProvider.getTiles(false);
        const expectedOutput = {
          tiles: [
            new Tile({
              statusBarHeight: 0,
              navBarHeight: 0,
              headerHeight: 0,
              footerHeight: 0,
              fullscreen: false,
              sha: 'abc'
            })
          ],
          domInfoSha: 'def',
          metadata: {}
        };
        expect(browserstackExecutorSpy).toHaveBeenCalledTimes(1);
        expect(executeScriptSpy).toHaveBeenCalledTimes(1);
        expect(res).toEqual(expectedOutput);
      });

      tilesErrorResponseCheck(automateProvider);
    });

    describe('singlepage', () => {
      const automateProvider = new AutomateProvider('1234', 'https://localhost/command-executor', { platform: 'win' }, {}, 'client', 'environment', {}, percyBuildInfo);
      beforeEach(async () => {
        Cache.reset();
        spyOn(Driver.prototype, 'getCapabilites');
        browserstackExecutorSpy = spyOn(AutomateProvider.prototype, 'browserstackExecutor')
          .and.returnValue(Promise.resolve({ value: '{"success": true, "result": "{\\"tiles\\":[{\\"sha\\":\\"abc\\",\\"status_bar\\":0,\\"nav_bar\\":156,\\"header_height\\":0,\\"footer_height\\":156,\\"index\\":0}],\\"dom_sha\\":\\"def\\"}"}' }));
        executeScriptSpy = spyOn(Driver.prototype, 'executeScript')
          .and.returnValue(Promise.resolve(1));
      });

      it('should return tiles when success', async () => {
        await automateProvider.createDriver();
        const res = await automateProvider.getTiles(false);
        const expectedOutput = {
          tiles: [
            new Tile({
              statusBarHeight: 0,
              navBarHeight: 156,
              headerHeight: 0,
              footerHeight: 156,
              fullscreen: false,
              sha: 'abc'
            })
          ],
          domInfoSha: 'def',
          metadata: {}
        };
        expect(browserstackExecutorSpy).toHaveBeenCalledTimes(1);
        expect(executeScriptSpy).toHaveBeenCalledTimes(1);
        expect(res).toEqual(expectedOutput);
      });
      tilesErrorResponseCheck(automateProvider);
    });
  });

  describe('getTag', () => {
    let percyScreenshotBeginSpy;
    let windowSizeSpy;
    let orientationSpy;
    let resolutionSpy;
    let percyBuildInfo = {
      id: '123',
      url: 'https://percy.io/abc/123'
    };

    describe('for desktop', () => {
      const automateProvider = new AutomateProvider('1234', 'https://localhost/command-executor', { platform: 'win' }, {}, 'client', 'environment', {}, percyBuildInfo);
      beforeEach(async () => {
        percyScreenshotBeginSpy = spyOn(AutomateProvider.prototype,
          'percyScreenshotBegin').and.returnValue({ value: '{"buildHash":"12e3","sessionHash":"abc1d","capabilities":{"browserName":"chrome","browserVersion":"113.0","os":"win11","os_version":"11","deviceOrientation":false,"resolution":["1920","1080"]},"success":true,"deviceName":"x.x.x.x"}' });
        spyOn(Driver.prototype, 'getCapabilites');
        windowSizeSpy = spyOn(DesktopMetaData.prototype, 'windowSize')
          .and.returnValue(Promise.resolve({ width: 1000, height: 1000 }));
        resolutionSpy = spyOn(DesktopMetaData.prototype, 'screenResolution')
          .and.returnValue('1980 x 1080');
        orientationSpy = spyOn(DesktopMetaData.prototype, 'orientation')
          .and.returnValue('landscape');
      });

      it('generates comparison tag for desktop', async () => {
        await automateProvider.createDriver();
        await automateProvider.screenshot('abc', { });

        const res = await automateProvider.getTag();

        expect(percyScreenshotBeginSpy).toHaveBeenCalledWith('abc');
        expect(windowSizeSpy).toHaveBeenCalledTimes(1);
        expect(resolutionSpy).toHaveBeenCalledTimes(1);
        expect(orientationSpy).toHaveBeenCalledTimes(1);
        expect(res).toEqual({
          name: 'Windows_11_chrome_113',
          osName: 'Windows',
          osVersion: '11',
          width: 1000,
          height: 1000,
          orientation: 'landscape',
          browserName: 'chrome',
          browserVersion: '113',
          resolution: '1980 x 1080'
        });
      });
    });

    describe('for devices', () => {
      const automateProvider = new AutomateProvider('1234', 'https://localhost/command-executor', { platform: 'android' }, {}, 'client', 'environment', {}, percyBuildInfo);
      beforeEach(async () => {
        percyScreenshotBeginSpy = spyOn(AutomateProvider.prototype,
          'percyScreenshotBegin').and.returnValue({ value: '{"buildHash":"12e3","sessionHash":"abc1d","capabilities":{"browserName":"chrome_android","browserVersion":"chrome_android","os":"android","os_version":"11","deviceOrientation":"portrait","resolution":["1920","1080"]},"success":true,"deviceName":"Samsung Galaxy S21"}' });
        spyOn(Driver.prototype, 'getCapabilites');
        windowSizeSpy = spyOn(MobileMetaData.prototype, 'windowSize')
          .and.returnValue(Promise.resolve({ width: 1000, height: 1000 }));
        resolutionSpy = spyOn(MobileMetaData.prototype, 'screenResolution')
          .and.returnValue('1980 x 1080');
        orientationSpy = spyOn(MobileMetaData.prototype, 'orientation')
          .and.returnValue(undefined);
      });

      it('generates comparsion tag for mobile', async () => {
        await automateProvider.createDriver();
        await automateProvider.screenshot('abc', { });

        const res = await automateProvider.getTag();

        expect(percyScreenshotBeginSpy).toHaveBeenCalledWith('abc');
        expect(windowSizeSpy).toHaveBeenCalledTimes(1);
        expect(resolutionSpy).toHaveBeenCalledTimes(1);
        expect(orientationSpy).toHaveBeenCalledTimes(1);
        expect(res).toEqual({
          name: 'Samsung Galaxy S21',
          osName: 'Android',
          osVersion: '11',
          width: 1000,
          height: 1000,
          orientation: 'portrait',
          browserName: 'chrome',
          browserVersion: 'Samsung Galaxy S21',
          resolution: '1980 x 1080'
        });
      });
    });

    describe('driver is null', () => {
      it('throws Error when called without initializing driver', async () => {
        let automateProvider = new AutomateProvider('1234', 'https://localhost/command-executor', { platform: 'win' }, {}, 'client', 'environment', {}, percyBuildInfo);
        await expectAsync(automateProvider.getTag())
          .toBeRejectedWithError('Driver is null, please initialize driver with createDriver().');
      });
    });

    describe('automateResults is null', () => {
      it('throws Error automateResults are not available', async () => {
        let automateProvider = new AutomateProvider('1234', 'https://localhost/command-executor', { platform: 'win' }, {}, 'client', 'environment', {}, percyBuildInfo);
        await automateProvider.createDriver();
        await expectAsync(automateProvider.getTag())
          .toBeRejectedWithError('Comparison tag details not available');
      });
    });
  });
});
