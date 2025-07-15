import command from '@percy/cli-command';
import { validateCredentials } from './utils.js';

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
      description: 'Username for authentication (can also be set via PERCY_USERNAME env var)',
      type: 'string'
    },
    {
      name: 'access-key',
      description: 'Access key for authentication (can also be set via PERCY_ACCESS_KEY env var)',
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
  const { username, accessKey } = validateCredentials(flags);

  if (!username || !accessKey) {
    exit(1, 'Username and access key are required to approve builds.');
  }

  log.info('Approving build...');

  try {
    // Call the Percy API to approve the build
    const buildApprovalResponse = await percy.client.approveBuild(
      args.buildId,
      username,
      accessKey
    );

    log.debug(`Build approved successfully: ${JSON.stringify(buildApprovalResponse)}`);
    // To add Approved by name here once that changes are deployed from API
    log.info('Build approved successfully');
  } catch (error) {
    log.error(error);

    // Provide user-friendly error message
    exit(1, 'Failed to approve the build');
  }
});

export default approve;
