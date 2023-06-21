import Driver from '../../src/driver.js';
import GenericProvider from '../../src/providers/genericProvider.js';
import AutomateProvider from '../../src/providers/automateProvider.js';
import Tile from '../../src/util/tile.js';

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

    beforeEach(async () => {
      executeScriptSpy = spyOn(Driver.prototype, 'executeScript');
      spyOn(Driver.prototype, 'getCapabilites');
    });

    it('throws Error when called without initializing driver', async () => {
      let automateProvider = new AutomateProvider('1234', 'https://localhost/command-executor', { platform: 'win' }, {});
      await expectAsync(automateProvider.browserstackExecutor('getSessionDetails'))
        .toBeRejectedWithError('Driver is null, please initialize driver with createDriver().');
    });

    it('calls browserstackExecutor with correct arguemnts for actions only', async () => {
      let automateProvider = new AutomateProvider('1234', 'https://localhost/command-executor', { platform: 'win' }, {});
      await automateProvider.createDriver();
      await automateProvider.browserstackExecutor('getSessionDetails');
      expect(executeScriptSpy)
        .toHaveBeenCalledWith({ script: 'browserstack_executor: {"action":"getSessionDetails"}', args: [] });
    });

    it('calls browserstackExecutor with correct arguemnts for actions + args', async () => {
      let automateProvider = new AutomateProvider('1234', 'https://localhost/command-executor', { platform: 'win' }, {});
      await automateProvider.createDriver();
      await automateProvider.browserstackExecutor('getSessionDetails', 'new');
      expect(executeScriptSpy)
        .toHaveBeenCalledWith({ script: 'browserstack_executor: {"action":"getSessionDetails","arguments":"new"}', args: [] });
    });
  });

  describe('setDebugUrl', () => {
    let browserstackExecutorSpy;

    beforeEach(async () => {
      spyOn(Driver.prototype, 'getCapabilites');
      browserstackExecutorSpy = spyOn(AutomateProvider.prototype, 'browserstackExecutor')
        .and.returnValue(Promise.resolve({ value: '{"browser_url": "http:localhost"}' }));
    });

    it('calls browserstackExecutor getSessionDetails', async () => {
      let automateProvider = new AutomateProvider('1234', 'https://localhost/command-executor', { platform: 'win' }, {});
      await automateProvider.createDriver();
      await automateProvider.setDebugUrl();
      expect(browserstackExecutorSpy).toHaveBeenCalledWith('getSessionDetails');
      expect(automateProvider.debugUrl).toEqual('http:localhost');
    });

    it('throws error if driver is not initialized', async () => {
      let automateProvider = new AutomateProvider('1234', 'https://localhost/command-executor', { platform: 'win' }, {});
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
    const ignoreRegionOptions = { ignoreRegionXpaths: [], ignoreRegionSelectors: [], ignoreRegionElements: [], customIgnoreRegions: [] };
    const automateProvider = new AutomateProvider('1234', 'https://localhost/command-executor', { platform: 'win' }, {});

    beforeEach(async () => {
      percyScreenshotBeginSpy = spyOn(AutomateProvider.prototype,
        'percyScreenshotBegin').and.returnValue(true);
      percyScreenshotEndSpy = spyOn(AutomateProvider.prototype,
        'percyScreenshotEnd').and.returnValue(true);
      spyOn(Driver.prototype, 'getCapabilites');
    });

    it('test call with default args', async () => {
      await automateProvider.createDriver();
      superScreenshotSpy.and.resolveTo({ body: { link: 'link to screenshot' } });
      await automateProvider.screenshot('abc', ignoreRegionOptions);

      expect(percyScreenshotBeginSpy).toHaveBeenCalledWith('abc');
      expect(superScreenshotSpy).toHaveBeenCalledWith('abc', ignoreRegionOptions);
      expect(percyScreenshotEndSpy).toHaveBeenCalledWith('abc', 'link to screenshot', 'undefined');
    });

    it('passes exception message to percyScreenshotEnd in case of exception', async () => {
      await automateProvider.createDriver();
      const errorMessage = 'Some error occured';
      superScreenshotSpy.and.rejectWith(new Error(errorMessage));
      percyScreenshotEndSpy.and.rejectWith(new Error(errorMessage));
      await expectAsync(automateProvider.screenshot('abc', ignoreRegionOptions)).toBeRejectedWithError(errorMessage);
      expect(percyScreenshotBeginSpy).toHaveBeenCalledWith('abc');
      expect(percyScreenshotEndSpy).toHaveBeenCalledWith('abc', undefined, `Error: ${errorMessage}`);
    });
  });

  describe('percyScreenshotBegin', () => {
    beforeEach(async () => {
      spyOn(Driver.prototype, 'getCapabilites');
    });

    it('supresses exception and does not throw', async () => {
      const automateProvider = new AutomateProvider('1234', 'https://localhost/command-executor', { platform: 'win' }, {});
      await automateProvider.createDriver();
      automateProvider.driver.executeScript = jasmine.createSpy().and.rejectWith(new Error('Random network error'));
      await automateProvider.percyScreenshotBegin('abc');
    });

    it('marks the percy session as success', async () => {
      const automateProvider = new AutomateProvider('1234', 'https://localhost/command-executor', { platform: 'win' }, {});
      await automateProvider.createDriver();
      automateProvider.driver.executeScript = jasmine.createSpy().and.returnValue(Promise.resolve({ success: true }));
      await automateProvider.percyScreenshotBegin('abc');
      expect(automateProvider._markedPercy).toBeTruthy();
    });
  });

  describe('percyScreenshotEnd', () => {
    const automateProvider = new AutomateProvider('1234', 'https://localhost/command-executor', { platform: 'win' }, {});

    beforeEach(async () => {
      spyOn(Driver.prototype, 'getCapabilites');
    });

    it('supresses exception and does not throw', async () => {
      await automateProvider.createDriver();
      automateProvider.driver = jasmine.createSpy().and.rejectWith(new Error('Random network error'));
      await automateProvider.percyScreenshotEnd('abc', 'url');
    });

    it('marks status as failed if screenshot url is not present', async () => {
      await automateProvider.createDriver();
      automateProvider.driver.executeScript = jasmine.createSpy().and.rejectWith(new Error('Random network error'));
      await automateProvider.percyScreenshotEnd('abc');

      expect(automateProvider.driver.executeScript).toHaveBeenCalledWith({ script: 'browserstack_executor: {"action":"percyScreenshot","arguments":{"name":"abc","status":"failure","statusMessage":null,"state":"end"}}', args: [] });
    });
  });

  describe('getTiles', () => {
    let browserstackExecutorSpy;
    let executeScriptSpy;
    const automateProvider = new AutomateProvider('1234', 'https://localhost/command-executor', { platform: 'win' }, {});

    beforeEach(async () => {
      spyOn(Driver.prototype, 'getCapabilites');
      browserstackExecutorSpy = spyOn(AutomateProvider.prototype, 'browserstackExecutor')
        .and.returnValue(Promise.resolve({ value: '{ "result": "{\\"dom_sha\\": \\"abc\\", \\"sha\\": [\\"abc-1\\", \\"xyz-2\\"]}", "success":true }' }));
      executeScriptSpy = spyOn(Driver.prototype, 'executeScript')
        .and.returnValue(Promise.resolve(1));
    });

    it('should return tiles when success', async () => {
      await automateProvider.createDriver();
      const res = await automateProvider.getTiles(false);
      expect(browserstackExecutorSpy).toHaveBeenCalledTimes(1);
      expect(executeScriptSpy).toHaveBeenCalledTimes(1);
      expect(Object.keys(res).length).toEqual(2);
      expect(res.domSha).toBe('abc');
      expect(res.tiles.length).toEqual(2);
      expect(res.tiles[0]).toBeInstanceOf(Tile);
      expect(res.tiles[1]).toBeInstanceOf(Tile);
      expect(res.tiles[0].sha).toEqual('abc');
      expect(res.tiles[1].sha).toEqual('xyz');
    });

    it('throws error when response is false', async () => {
      await automateProvider.createDriver();
      browserstackExecutorSpy.and.returnValue(Promise.resolve({ value: '{ "error": "Random Error", "success":false }' }));
      await expectAsync(automateProvider.getTiles(false)).toBeRejectedWithError('Failed to get screenshots from Automate.' +
        ' Check dashboard for error.');
    });

    it('throws error when driver is null', async () => {
      automateProvider.driver = null;
      await expectAsync(automateProvider.getTiles(false)).toBeRejectedWithError('Driver is null, please initialize driver with createDriver().');
    });
  });
});
