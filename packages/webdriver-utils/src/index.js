import ProviderResolver from './providers/providerResolver.js';
import utils from '@percy/sdk-utils';
import { camelcase } from '@percy/config/utils';

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
      options = {},
      buildInfo = {}
    }) {
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
    this.clientInfo = clientInfo;
    this.environmentInfo = environmentInfo;
    this.buildInfo = buildInfo;
  }

  async automateScreenshot() {
    try {
      this.log.info('Starting automate screenshot ...');
      const automate = ProviderResolver.resolve(this.sessionId, this.commandExecutorUrl, this.capabilities, this.sessionCapabilites, this.clientInfo, this.environmentInfo, this.options, this.buildInfo);
      this.log.debug('Resolved provider ...');
      await automate.createDriver();
      this.log.debug('Created driver ...');
      return await automate.screenshot(this.snapshotName, this.options);
    } catch (e) {
      this.log.error(`[${this.snapshotName}] : Error - ${e.message}`);
      this.log.error(`[${this.snapshotName}] : Error Log - ${e.toString()}`);
    }
  }
}
