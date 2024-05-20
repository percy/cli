import ProviderResolver from './providers/providerResolver.js';
import utils from '@percy/sdk-utils';
import PlaywrightProvider from './providers/playwrightProvider.js';

export default class WebdriverUtils {
  static async automateScreenshot({
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
    const log = utils.logger('webdriver-utils:automateScreenshot');
    try {
      const startTime = Date.now();
      log.info(`[${snapshotName}] : Starting automate screenshot ...`);
      const automate = ProviderResolver.resolve(sessionId, commandExecutorUrl, capabilities, sessionCapabilites, clientInfo, environmentInfo, options, buildInfo);
      log.debug(`[${snapshotName}] : Resolved provider ...`);
      await automate.createDriver();
      log.debug(`[${snapshotName}] : Created driver ...`);
      const comparisonData = await automate.screenshot(snapshotName, options);
      comparisonData.metadata.cliScreenshotStartTime = startTime;
      comparisonData.metadata.cliScreenshotEndTime = Date.now();
      comparisonData.sync = options.sync;
      comparisonData.testCase = options.testCase;
      comparisonData.thTestCaseExecutionId = options.thTestCaseExecutionId;
      log.debug(`[${snapshotName}] : Comparison Data: ${JSON.stringify(comparisonData)}`);
      return comparisonData;
    } catch (e) {
      log.error(`[${snapshotName}] : Error - ${e.message}`);
      log.error(`[${snapshotName}] : Error Log - ${e.toString()}`);
    }
  }

  static async playwrightScreenshot({
    sessionId,
    frameGuid,
    pageGuid,
    snapshotName,
    clientInfo,
    environmentInfo,
    options = {},
    buildInfo = {}
  }) {
    const log = utils.logger('webdriver-utils:automateScreenshot');
    try {
      const startTime = Date.now();
      log.info(`[${snapshotName}] : Starting playwright screenshot ...`);
      const playwright = new PlaywrightProvider(sessionId, frameGuid, pageGuid, clientInfo, environmentInfo, options, buildInfo);
      log.debug(`[${snapshotName}] : Resolved provider ...`);
      await playwright.createDriver();
      log.debug(`[${snapshotName}] : Created driver ...`);
      const comparisonData = await playwright.screenshot(snapshotName, options);
      comparisonData.metadata.cliScreenshotStartTime = startTime;
      comparisonData.metadata.cliScreenshotEndTime = Date.now();
      comparisonData.sync = options.sync;
      comparisonData.testCase = options.testCase;
      comparisonData.thTestCaseExecutionId = options.thTestCaseExecutionId;
      log.debug(`[${snapshotName}] : Comparison Data: ${JSON.stringify(comparisonData)}`);
      return comparisonData;
    } catch (e) {
      log.error(`[${snapshotName}] : Error - ${e.message}`);
      log.error(`[${snapshotName}] : Error Log - ${e.toString()}`);
    }
  }
}
