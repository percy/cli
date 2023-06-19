import ProviderResolver from './providers/providerResolver.js';
import utils from '@percy/sdk-utils';
import { camelcase } from '@percy/config/utils';

export default class WebdriverUtils {
  log = utils.logger('webdriver-utils:main');
  constructor({ sessionId, commandExecutorUrl, capabilities, sessionCapabilites, snapshotName, options = {} }) {
    this.sessionId = sessionId;
    this.commandExecutorUrl = commandExecutorUrl;
    this.capabilities = capabilities;
    this.sessionCapabilites = sessionCapabilites;
    this.snapshotName = snapshotName;
    const camelCasedOptions = {};
    Object.keys(options).forEach((key) => {
      let newKey = camelcase(key);
      camelCasedOptions[newKey] = options[key];
    });
    this.options = camelCasedOptions;
  }

  async automateScreenshot() {
    this.log.info('Starting automate screenshot');
    const automate = ProviderResolver.resolve(this.sessionId, this.commandExecutorUrl, this.capabilities, this.sessionCapabilites);
    await automate.createDriver();
    return await automate.screenshot(this.snapshotName, this.options);
  }
}
