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
      const startTime = Date.now();
      this.log.info(`[${this.snapshotName}] : Starting automate screenshot ...`);
      const automate = ProviderResolver.resolve(this.sessionId, this.commandExecutorUrl, this.capabilities, this.sessionCapabilites, this.clientInfo, this.environmentInfo, this.options, this.buildInfo);
      this.log.debug(`[${this.snapshotName}] : Resolved provider ...`);
      await automate.createDriver();
      this.log.debug(`[${this.snapshotName}] : Created driver ...`);
      const comparisonData = await automate.screenshot(this.snapshotName, this.options);
      comparisonData.metadata.cliScreenshotStartTime = startTime;
      comparisonData.metadata.cliScreenshotEndTime = Date.now();
      return comparisonData;
    } catch (e) {
      this.log.error(`[${this.snapshotName}] : Error - ${e.message}`);
      this.log.error(`[${this.snapshotName}] : Error Log - ${e.toString()}`);
    }
  }
}
