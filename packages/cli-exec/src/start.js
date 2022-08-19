import command from '@percy/cli-command';

export const start = command('start', {
  description: 'Starts a locally running Percy process',
  examples: ['$0 &> percy.log'],
  percy: { server: true }
}, async function*({ percy, exit }) {
  if (!percy) exit(0, 'Percy is disabled');
  let { yieldFor } = await import('@percy/cli-command/utils');

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
