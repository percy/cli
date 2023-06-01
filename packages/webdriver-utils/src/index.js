import ProviderResolver from './providers/providerResolver.js';
import utils from '@percy/sdk-utils';

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
      let newKey = key;
      if (key.includes('_')) { // only call if snakecase
        newKey = this.snakeToCamel(key);
      }
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

  snakeToCamel(str) {
    return str.toLowerCase().replace(/([_][a-z])/g, (group) =>
      group
        .toUpperCase()
        .replace('_', '')
    );
  }
}
