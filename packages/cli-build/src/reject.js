import command from '@percy/cli-command';
import { fetchCredentials, reviewCommandConfig } from './utils.js';

/**
 * Reject command definition for Percy builds
 * Allows users to reject builds using build ID and authentication credentials
 */
export const reject = command('reject', {
  description: 'Reject Percy builds',
  ...reviewCommandConfig
}, async ({ flags, args, percy, log, exit }) => {
  // Early return if Percy is disabled
  if (!percy) {
    exit(0, 'Percy is disabled');
  }

  // Validate and get authentication credentials
  const { username, accessKey } = fetchCredentials(flags);

  if (!username || !accessKey) {
    exit(1, 'Username and access key are required to reject builds.');
  }

  log.info(`Rejecting build ${args.buildId}...`);

  try {
    // Call the Percy API to reject the build
    const buildRejectionResponse = await percy.client.rejectBuild(
      args.buildId,
      username,
      accessKey
    );

    const rejectedBy = buildRejectionResponse.data.attributes['action-performed-by'] || {
      user_email: 'unknown@example.com',
      user_name: username
    };
    log.info(`Build ${args.buildId} rejected successfully!`);
    log.info(`Rejected by: ${rejectedBy.user_name} (${rejectedBy.user_email})`);
  } catch (error) {
    log.error(`Failed to reject build ${args.buildId}`);
    log.error(error);

    // Provide user-friendly error message
    exit(1, 'Failed to reject the build');
  }
});

export default reject;
