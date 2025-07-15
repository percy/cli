/**
 * Constants for environment variable names and error messages
 */
const ENV_VARS = {
  PERCY_USERNAME: 'PERCY_USERNAME',
  PERCY_ACCESS_KEY: 'PERCY_ACCESS_KEY'
};

/**
 * Validates that required authentication credentials are present
 * @param {Object} flags - Command flags object
 * @returns {Object} Validated credentials object
 */
export function validateCredentials(flags) {
  // Use flags if provided, otherwise fallback to environment variables
  const username = flags.username || process.env[ENV_VARS.PERCY_USERNAME];
  const accessKey = flags.accessKey || process.env[ENV_VARS.PERCY_ACCESS_KEY];

  return { username, accessKey };
}
