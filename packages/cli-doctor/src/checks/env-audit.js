/**
 * Audit Percy-specific environment variables: list what's set, validate
 * formats, detect manual overrides, and flag insecure settings.
 * Plain async function — matches monorepo functional style.
 *
 * SECURITY: Never expose environment variable VALUES in findings.
 * Only report variable NAMES and validation status.
 *
 * @returns {Promise<Finding[]>}
 */
export async function checkEnvVars() {
  const findings = [];

  // Known Percy environment variables
  const PERCY_VARS = [
    'PERCY_TOKEN', 'PERCY_BUILD_ID', 'PERCY_BUILD_URL',
    'PERCY_BROWSER_EXECUTABLE', 'PERCY_CHROMIUM_BASE_URL',
    'PERCY_PAC_FILE_URL', 'PERCY_CLIENT_API_URL',
    'PERCY_SERVER_ADDRESS', 'PERCY_SERVER_HOST',
    'PERCY_COMMIT', 'PERCY_BRANCH', 'PERCY_PULL_REQUEST',
    'PERCY_TARGET_COMMIT', 'PERCY_TARGET_BRANCH',
    'PERCY_PARALLEL_TOTAL', 'PERCY_PARALLEL_NONCE',
    'PERCY_PARTIAL_BUILD', 'PERCY_AUTO_ENABLED_GROUP_BUILD',
    'PERCY_DEBUG', 'PERCY_LOGLEVEL', 'PERCY_GZIP',
    'PERCY_IGNORE_DUPLICATES', 'PERCY_IGNORE_TIMEOUT_ERROR',
    'PERCY_SNAPSHOT_UPLOAD_CONCURRENCY', 'PERCY_RESOURCE_UPLOAD_CONCURRENCY',
    'PERCY_NETWORK_IDLE_WAIT_TIMEOUT', 'PERCY_PAGE_LOAD_TIMEOUT',
    'PERCY_DISABLE_SYSTEM_MONITORING', 'PERCY_METRICS',
    'PERCY_SKIP_GIT_CHECK', 'PERCY_DISABLE_DOTENV',
    'PERCY_EXIT_WITH_ZERO_ON_ERROR', 'PERCY_AUTO_DOCTOR'
  ];

  // 1. Collect all set Percy env vars (report names only, NEVER values)
  const setVars = PERCY_VARS.filter(key => process.env[key] !== undefined);

  if (setVars.length === 0) {
    findings.push({
      code: 'PERCY-DR-300',
      status: 'info',
      message: 'No Percy-specific environment variables detected (only PERCY_TOKEN is required).'
    });
  } else {
    findings.push({
      code: 'PERCY-DR-301',
      status: 'info',
      message: `Percy environment variables set: ${setVars.join(', ')}`
    });
  }

  // 2. Validate PERCY_PARALLEL_TOTAL format
  if (process.env.PERCY_PARALLEL_TOTAL) {
    const val = parseInt(process.env.PERCY_PARALLEL_TOTAL, 10);
    if (isNaN(val) || val <= 0) {
      findings.push({
        code: 'PERCY-DR-303',
        status: 'fail',
        message: 'PERCY_PARALLEL_TOTAL is not a valid positive integer.',
        suggestions: [
          'Set PERCY_PARALLEL_TOTAL to a positive integer (e.g., 4).',
          'This controls how many parallel Percy build shards to expect.'
        ]
      });
    }
  }

  // 3. Warn about manual overrides
  const overrideVars = ['PERCY_COMMIT', 'PERCY_BRANCH', 'PERCY_PULL_REQUEST'];
  const activeOverrides = overrideVars.filter(k => process.env[k]);
  if (activeOverrides.length > 0) {
    findings.push({
      code: 'PERCY-DR-304',
      status: 'info',
      message: `Manual overrides active: ${activeOverrides.join(', ')} — these override CI-detected values.`
    });
  }

  // 4. Detect NODE_TLS_REJECT_UNAUTHORIZED=0
  if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0') {
    findings.push({
      code: 'PERCY-DR-305',
      status: 'warn',
      message: 'NODE_TLS_REJECT_UNAUTHORIZED=0 — SSL certificate validation is globally disabled.',
      suggestions: [
        'This disables ALL SSL certificate validation for this process.',
        'Use NODE_EXTRA_CA_CERTS=/path/to/ca.crt for a safer permanent fix.',
        'Only use NODE_TLS_REJECT_UNAUTHORIZED=0 for temporary debugging.'
      ]
    });
  }

  return findings;
}
