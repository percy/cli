import command from '@percy/cli-command';

export const finalize = command('finalize', {
  description: 'Finalize parallel Percy builds',
  percy: true
}, async ({ env, percy, log, exit }) => {
  if (!percy) exit(0, 'Percy is disabled');

  // automatically set parallel total to -1
  env.PERCY_PARALLEL_TOTAL ||= '-1';

  // ensure that this command is not used for other parallel totals
  if (env.PERCY_PARALLEL_TOTAL !== '-1') {
    log.error('This command should only be used with PERCY_PARALLEL_TOTAL=-1');
    log.error(`Current value is "${env.PERCY_PARALLEL_TOTAL}"`);
    exit(1);
  }

  log.info('Finalizing parallel build...');

  // rely on the parallel nonce to cause the API to return the current running build for the nonce
  let { data: build } = await percy.client.createBuild({ cliStartTime: percy.cliStartTime });
  try {
    // Wait for snapshot counts to stabilise across all shards before finalizing.
    // Without this guard, percy build:finalize can race against snapshot-level
    // upload/finalize requests that are still in-flight on other shards.
    await percy.client.waitForBuildReadyToFinalize(build.id);
    await percy.client.finalizeBuild(build.id, { all: true });
  } catch (error) {
    exit(1, 'Percy build failed during finalize', error.message);
  }
  let { 'build-number': number, 'web-url': url } = build.attributes;
  log.info(`Finalized build #${number}: ${url}`);
});

export default finalize;
