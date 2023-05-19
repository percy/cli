import ProviderResolver from './providers/providerResolver.js';
import utils from '@percy/sdk-utils';

export default class WebdriverUtils {
  log = utils.logger('webdriver-utils:main');
  constructor({ sessionId, commandExecutorUrl, capabilities, sessionCapabilites, snapshotName }) {
    this.sessionId = sessionId;
    this.commandExecutorUrl = commandExecutorUrl;
    this.capabilities = capabilities;
    this.sessionCapabilites = sessionCapabilites;
    this.snapshotName = snapshotName;
  }

  async automateScreenshot() {
    this.log.info('Starting automate screenshot');
    const automate = ProviderResolver.resolve(this.sessionId, this.commandExecutorUrl, this.capabilities, this.sessionCapabilites);
    await automate.createDriver();
    return await automate.screenshot(this.snapshotName);
  }
}
