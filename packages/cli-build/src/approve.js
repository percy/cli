import command from '@percy/cli-command';
import { fetchCredentials, reviewCommandConfig } from './utils.js';

/**
 * Approve command definition for Percy builds
 * Allows users to approve builds using build ID and authentication credentials
 */
export const approve = command('approve', {
  description: 'Approve Percy builds',
  ...reviewCommandConfig,
  ...{
    flags: [
      ...reviewCommandConfig.flags,
      {
        name: 'pass-if-previously-approved',
        description: 'Does not exit with an error if the build has previous approvals'
      }
    ],
    examples: [
      ...reviewCommandConfig.examples,
      '$0 <build-id> --pass-if-previously-approved'
    ]
  }
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

    const approvedBy = buildApprovalResponse.data.attributes['action-performed-by'] || {
      user_email: 'unknown@example.com',
      user_name: username
    };
    log.info(`Build ${args.buildId} approved successfully!`);
    log.info(`Approved by: ${approvedBy.user_name} (${approvedBy.user_email})`);
  } catch (error) {
    if (
      flags.passIfPreviouslyApproved &&
      Array.isArray(error?.response?.body?.errors) &&
      error.response.body.errors.some(e => e.detail === 'approve action is already performed on this build')
    ) {
      log.info(`Build ${args.buildId} is already approved: skipping approval`);
      exit(0);
    }

    log.error(`Failed to approve build ${args.buildId}`);
    log.error(error);

    // Provide user-friendly error message
    exit(1, 'Failed to approve the build');
  }
});

export default approve;
