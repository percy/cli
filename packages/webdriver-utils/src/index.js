import ProviderResolver from './providers/providerResolver.js';
import utils from '@percy/sdk-utils';

const log = utils.logger('webdriver-utils:main');

export default async function automateScreenshot(options) {
  log.info('Starting automate screenshot');
  const automate = ProviderResolver.resolve(options.sessionId, options.commandExecutorUrl, options.capabilities, options.sessionCapabilites);
  await automate.createDriver();
  await automate.screenshot(options.snapshotName);
}
