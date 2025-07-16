import command from '@percy/cli-command';
import { fetchCredentials } from './utils.js';

/**
 * Reject command definition for Percy builds
 * Allows users to reject builds using build ID and authentication credentials
 */
export const reject = command('reject', {
  description: 'Reject Percy builds',

  args: [
    {
      name: 'build-id',
      description: 'Build ID to reject',
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

    // // Mocking the response for testing purposes
    // // The API changes are not implemented yet, so we simulate the response
    // // This will be removed before merging
    // if (!buildRejectionResponse.data.attributes['latest-action-performed-by']) {
    //   buildRejectionResponse.data.attributes['latest-action-performed-by'] = {
    //     user_email: 'moin@test.com',
    //     user_name: 'moin'
    //   };
    // }

    const rejectedBy = buildRejectionResponse.data.attributes['latest-action-performed-by'] || {
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
