import Driver from '../../src/driver.js'
import AutomateProvider from '../../src/providers/automateProvider.js'

describe('AutomateProvider', () => {
  describe('browserstackExecutor', () => {
    let executeScriptSpy;
    let capabilitiesSpy;

    beforeEach(async () => {
      executeScriptSpy = spyOn(Driver.prototype, 'executeScript');
      capabilitiesSpy = spyOn(Driver.prototype, 'getCapabilites')
    });

    it('throws Error when called without initializing driver', async () => {
      let automateProvider = new AutomateProvider('1234', 'command-browserstack', {platform: 'win'}, {});
      await expectAsync(automateProvider.browserstackExecutor('getSessionDetails'))
        .toBeRejectedWithError('Driver is null, please initialize driver with createDriver().');
    })

    it('calls browserstackExecutor with correct arguemnts', async () => {
      let automateProvider = new AutomateProvider('1234', 'command-browserstack', {platform: 'win'}, {});
      await automateProvider.createDriver();
      await automateProvider.browserstackExecutor('getSessionDetails');
      expect(executeScriptSpy)
        .toHaveBeenCalledWith({script: `browserstack_executor: {"action":"getSessionDetails"}`, args: []});
    })
  })
})