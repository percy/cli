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
