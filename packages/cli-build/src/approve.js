import command from '@percy/cli-command';
import { fetchCredentials } from './utils.js';

/**
 * Approve command definition for Percy builds
 * Allows users to approve builds using build ID and authentication credentials
 */
export const approve = command('approve', {
  description: 'Approve Percy builds',

  args: [
    {
      name: 'build-id',
      description: 'Build ID to approve',
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
    exit(1, 'Username and access key are required to approve builds.');
  }

  log.info(`Approving build ${args.buildId}...`);

  try {
    // Call the Percy API to approve the build
    const buildApprovalResponse = await percy.client.approveBuild(
      args.buildId,
      username,
      accessKey
    );

    // // Mocking the response for testing purposes
    // // The API changes are not implemented yet, so we simulate the response
    // // This will be removed before merging
    // if (!buildApprovalResponse.data.attributes['latest-action-performed-by']) {
    //   buildApprovalResponse.data.attributes['latest-action-performed-by'] = {
    //     user_email: 'moin@test.com',
    //     user_name: 'moin'
    //   };
    // }

    const approvedBy = buildApprovalResponse.data.attributes['latest-action-performed-by'] || {
      user_email: 'unknown@example.com',
      user_name: username
    };
    log.info(`Build ${args.buildId} approved successfully!`);
    log.info(`Approved by: ${approvedBy.user_name} (${approvedBy.user_email})`);
  } catch (error) {
    log.error(`Failed to approve build ${args.buildId}`);
    log.error(error);

    // Provide user-friendly error message
    exit(1, 'Failed to approve the build');
  }
});

export default approve;
