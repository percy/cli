import ProviderResolver from './providers/providerResolver.js';
import utils from '@percy/sdk-utils';

export default class WebdriverUtils {
  log = utils.logger('webdriver-utils:main');
  constructor(
    {
      sessionId,
      commandExecutorUrl,
      capabilities,
      sessionCapabilites,
      snapshotName,
      clientInfo,
      environmentInfo,
      options
    }) {
    this.sessionId = sessionId;
    this.commandExecutorUrl = commandExecutorUrl;
    this.capabilities = capabilities;
    this.sessionCapabilites = sessionCapabilites;
    this.snapshotName = snapshotName;
    this.clientInfo = clientInfo;
    this.environmentInfo = environmentInfo;
    this.options = options;
  }

  async automateScreenshot() {
    this.log.info('Starting automate screenshot');
    const automate = ProviderResolver.resolve(this.sessionId, this.commandExecutorUrl, this.capabilities, this.sessionCapabilites, this.clientInfo, this.environmentInfo, this.options);
    await automate.createDriver();
    return await automate.screenshot(this.snapshotName);
  }
}
