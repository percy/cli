import GenericProvider from './genericProvider.js';

export default class AutomateProvider extends GenericProvider {
  constructor(
    sessionId,
    commandExecutorUrl,
    capabilities,
    snapshotName,
    sessionCapabilites
  ) {
    super(
    sessionId,
    commandExecutorUrl,
    capabilities,
    snapshotName,
    sessionCapabilites
    )
  }

  static supports(commandExecutorUrl) {
    return commandExecutorUrl.includes(process.env.AA_DOMAIN || 'browserstack');
  }

  async browserstackExecutor(action, args) {
    let options = args ? { action, arguments: args } : { action };
    let res = await this.driver.helper.executeScript({script:`browserstack_executor: ${JSON.stringify(options)}`, args: []}); 
    return res
  }

  async setDebugUrl() {
    const sessionDetails = await this.browserstackExecutor('getSessionDetails')
    this.debugUrl = JSON.parse(sessionDetails['value'])['browser_url']
  }
}