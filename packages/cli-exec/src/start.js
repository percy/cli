import command from '@percy/cli-command';

export const start = command('start', {
  description: 'Starts a locally running Percy process',
  examples: ['$0 &> percy.log'],
  percy: {
    server: true,
    projectType: 'web'
  }
}, async function*({ percy, log, exit }) {
  if (!percy) exit(0, 'Percy is disabled');
  let { yieldFor } = await import('@percy/cli-command/utils');
  // Skip this for app because they are triggered as app:exec
  // Remove this once they move to exec command as well
  if (percy.projectType !== 'app') {
    log.info('Percy project attribute calculation');
    percy.projectType = percy.client.tokenType();
    percy.skipDiscovery = percy.shouldSkipAssetDiscovery(percy.projectType);
  }

  // start percy
  yield* percy.yield.start();

  try {
    // run until stopped or terminated
    yield* yieldFor(() => percy.readyState >= 3);
  } catch (error) {
    await percy.stop(true);
    throw error;
  }
});

export default start;
