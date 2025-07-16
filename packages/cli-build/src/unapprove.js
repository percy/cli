import command from '@percy/cli-command';
import { fetchCredentials, reviewCommandConfig } from './utils.js';

/**
 * Unapprove command definition for Percy builds
 * Allows users to unapprove builds using build ID and authentication credentials
 */
export const unapprove = command('unapprove', {
  description: 'Unapprove Percy builds',
  ...reviewCommandConfig
}, async ({ flags, args, percy, log, exit }) => {
  // Early return if Percy is disabled
  if (!percy) {
    exit(0, 'Percy is disabled');
  }

  // Validate and get authentication credentials
  const { username, accessKey } = fetchCredentials(flags);

  if (!username || !accessKey) {
    exit(1, 'Username and access key are required to unapprove builds.');
  }

  log.info(`Unapproving build ${args.buildId}...`);

  try {
    // Call the Percy API to unapprove the build
    const buildUnapprovalResponse = await percy.client.unapproveBuild(
      args.buildId,
      username,
      accessKey
    );

    const unapprovedBy = buildUnapprovalResponse.data.attributes['action-performed-by'] || {
      user_email: 'unknown@example.com',
      user_name: username
    };
    log.info(`Build ${args.buildId} unapproved successfully!`);
    log.info(`Unapproved by: ${unapprovedBy.user_name} (${unapprovedBy.user_email})`);
  } catch (error) {
    log.error(`Failed to unapprove build ${args.buildId}`);
    log.error(error);

    // Provide user-friendly error message
    exit(1, 'Failed to unapprove the build');
  }
});

export default unapprove;
