/**
 * Constants for environment variable names and error messages
 */
const ENV_VARS = {
  BROWSERSTACK_USERNAME: 'BROWSERSTACK_USERNAME',
  BROWSERSTACK_ACCESS_KEY: 'BROWSERSTACK_ACCESS_KEY'
};

/**
 * Validates that required authentication credentials are present
 * @param {Object} flags - Command flags object
 * @returns {Object} Validated credentials object
 */
export function fetchCredentials(flags) {
  // Use flags if provided, otherwise fallback to environment variables
  const username = flags.username || process.env[ENV_VARS.BROWSERSTACK_USERNAME];
  const accessKey = flags.accessKey || process.env[ENV_VARS.BROWSERSTACK_ACCESS_KEY];

  return { username, accessKey };
}

/** * Configuration for review commands (approve, reject, unapprove)
 * Contains common arguments and flags used across these commands
 */
export const reviewCommandConfig = {
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
};
