import ProviderResolver from './providers/providerResolver.js';

export default async function automateScreenshot(options) {
  const automate = ProviderResolver.resolve(options.sessionId, options.commandExecutorUrl, options.capabilities, options.sessionCapabilites);
  await automate.createDriver();
  await automate.screenshot(options.snapshotName);
}

