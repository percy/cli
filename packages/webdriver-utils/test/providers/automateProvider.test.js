import Driver from '../../src/driver.js';
import GenericProvider from '../../src/providers/genericProvider.js';
import AutomateProvider from '../../src/providers/automateProvider.js';

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
      await automateProvider.screenshot('abc');

      expect(percyScreenshotBeginSpy).toHaveBeenCalledWith('abc');
      expect(superScreenshotSpy).toHaveBeenCalledWith('abc');
      expect(percyScreenshotEndSpy).toHaveBeenCalledWith('abc', 'link to screenshot', 'undefined');
    });

    it('passes exception message to percyScreenshotEnd in case of exception', async () => {
      await automateProvider.createDriver();
      const errorMessage = 'Some error occured';
      superScreenshotSpy.and.rejectWith(new Error(errorMessage));
      percyScreenshotEndSpy.and.rejectWith(new Error(errorMessage));
      await expectAsync(automateProvider.screenshot('abc')).toBeRejectedWithError(errorMessage);
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
});
