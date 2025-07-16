import command from '@percy/cli-command';
import { validateCredentials } from './utils.js';

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
  const { username, accessKey } = validateCredentials(flags);

  if (!username || !accessKey) {
    exit(1, 'Username and access key are required to reject builds.');
  }

  log.info('Rejecting build...');

  try {
    // Call the Percy API to reject the build
    const buildRejectionResponse = await percy.client.rejectBuild(
      args.buildId,
      username,
      accessKey
    );

    log.debug(`Build rejected successfully: ${JSON.stringify(buildRejectionResponse)}`);
    // To add Rejected by name here once that changes are deployed from API
    log.info('Build rejected successfully');
  } catch (error) {
    log.error(error);

    // Provide user-friendly error message
    exit(1, 'Failed to reject the build');
  }
});

export default reject;
