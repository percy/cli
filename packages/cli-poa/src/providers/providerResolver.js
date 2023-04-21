import GenericProvider from './genericProvider.js';
import AutomateProvider from './automateProvider.js';

export default class ProviderResolver {
  static resolve(sessionId, commandExecutorUrl, capabilities, snapshotName, sessionCapabilities) {
    // We can safely do [0] because GenericProvider is catch all
    const Klass = [AutomateProvider, GenericProvider].filter(x => x.supports(commandExecutorUrl))[0];
    return new Klass(sessionId, commandExecutorUrl, capabilities, snapshotName, sessionCapabilities);
  }
}
