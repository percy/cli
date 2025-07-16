import command from '@percy/cli-command';
import { fetchCredentials } from './utils.js';

/**
 * Unapprove command definition for Percy builds
 * Allows users to unapprove builds using build ID and authentication credentials
 */
export const unapprove = command('unapprove', {
  description: 'Unapprove Percy builds',

  args: [
    {
      name: 'build-id',
      description: 'Build ID to unapprove',
      type: 'id',
      required: true
    }
  ],

  flags: [
    {
      name: 'username',
      description: 'Username for authentication (can also be set via BROWSERSTACK_USERNAME env var)',
      type: 'string'
    },
    {
      name: 'access-key',
      description: 'Access key for authentication (can also be set via BROWSERSTACK_ACCESS_KEY env var)',
      type: 'string'
    }
  ],

  examples: [
    '$0 <build-id>',
    '$0 <build-id> --username username --access-key **key**'
  ],

  percy: true
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

    // Mocking the response for testing purposes
    // The API changes are not implemented yet, so we simulate the response
    // This will be removed before merging
    if (!buildUnapprovalResponse.data.attributes['latest-action-performed-by']) {
      buildUnapprovalResponse.data.attributes['latest-action-performed-by'] = {
        user_email: 'moin@test.com',
        user_name: 'moin'
      };
    }

    const unapprovedBy = buildUnapprovalResponse.data.attributes['latest-action-performed-by'] || {
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
