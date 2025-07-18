import command from '@percy/cli-command';
import { fetchCredentials, reviewCommandConfig } from './utils.js';

/**
 * Delete command definition for Percy builds
 * Allows users to delete builds using build ID and authentication credentials
 */
export const deleteBuild = command('delete', {
  description: 'Delete Percy builds',
  ...reviewCommandConfig
}, async ({ flags, args, percy, log, exit }) => {
  // Early return if Percy is disabled
  if (!percy) {
    exit(0, 'Percy is disabled');
  }

  // Validate and get authentication credentials
  const { username, accessKey } = fetchCredentials(flags);

  if (!username || !accessKey) {
    exit(1, 'Username and access key are required to delete builds.');
  }

  log.info(`Deleting build ${args.buildId}...`);

  try {
    // Call the Percy API to delete the build
    const buildDeletionResponse = await percy.client.deleteBuild(
      args.buildId,
      username,
      accessKey
    );
    const deletedBy = buildDeletionResponse['action-performed-by'] || {
      user_email: 'unknown@example.com',
      user_name: username
    };

    log.info(`Build ${args.buildId} deleted successfully!`);
    log.info(`Deleted by: ${deletedBy.user_name} (${deletedBy.user_email})`);
  } catch (error) {
    log.error(`Failed to delete build ${args.buildId}`);
    log.error(error);

    // Provide user-friendly error message
    exit(1, 'Failed to delete the build');
  }
});

export default deleteBuild;
