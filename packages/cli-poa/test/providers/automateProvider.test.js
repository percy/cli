import Driver from '../../src/driver.js'
import AutomateProvider from '../../src/providers/automateProvider.js'

describe('AutomateProvider', () => {
  describe('browserstackExecutor', () => {
    let executeScriptSpy;

    beforeEach(async () => {
      executeScriptSpy = spyOn(Driver.prototype, 'executeScript');
    });

    it('throws Error when called without initializing driver', async () => {
      let automateProvider = new AutomateProvider('1234', 'command-browserstack', {}, {});
      await expectAsync(automateProvider.browserstackExecutor('getSessionDetails'))
        .toBeRejectedWithError('Driver is null, please initialize driver with createDriver().');
    })

    it('calls browserstackExecutor with correct arguemnts', async () => {
      let automateProvider = new AutomateProvider('1234', 'command-browserstack', {}, {});
      await automateProvider.createDriver();
      await expectAsync(automateProvider.browserstackExecutor('getSessionDetails'))
        .toBeRejectedWithError('Driver is null, please initialize driver with createDriver().');
    })
  })
})