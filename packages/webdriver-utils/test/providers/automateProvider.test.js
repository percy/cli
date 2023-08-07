import Driver from '../../src/driver.js';
import AutomateProvider from '../../src/providers/automateProvider.js';

describe('AutomateProvider', () => {
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
});
