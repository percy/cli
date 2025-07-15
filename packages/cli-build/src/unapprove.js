import command from '@percy/cli-command';
import { validateCredentials } from './utils.js';

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
    exit(1, 'Username and access key are required to unapprove builds.');
  }

  log.info('Unapproving build...');

  try {
    // Call the Percy API to unapprove the build
    const buildUnapprovalResponse = await percy.client.unapproveBuild(
      args.buildId,
      username,
      accessKey
    );

    log.debug(`Build unapproved successfully: ${JSON.stringify(buildUnapprovalResponse)}`);
    // To add unApproved by name here once that changes are deployed from API
    log.info('Build unapproved successfully');
  } catch (error) {
    log.error(error);

    // Provide user-friendly error message
    exit(1, 'Failed to unapprove the build');
  }
});

export default unapprove;
