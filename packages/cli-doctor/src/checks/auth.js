import { httpProber } from '../utils/http.js';

// Strip token-like patterns from error messages to prevent credential leakage
function sanitizeError(msg) {
  if (!msg) return msg;
  return msg.replace(/Token token=[^\s,;]*/gi, 'Token token=***');
}

// Known token prefixes → project types (mirrors @percy/client tokenType())
const KNOWN_PREFIXES = {
  auto: 'automate',
  web: 'web',
  app: 'app',
  ss: 'generic',
  vmw: 'visual_scanner',
  res: 'responsive_scanner'
};

// Command suggestion by project type
const COMMAND_BY_TYPE = {
  app: 'percy app:exec',
  default: 'percy exec'
};

/**
 * Validate PERCY_TOKEN presence, format, and authentication.
 * Plain async function (not a class) — matches monorepo functional style.
 *
 * @param {object} options
 * @param {string} [options.proxyUrl]    - Proxy for API call (from ctx.bestProxy)
 * @param {number} [options.timeout]     - Request timeout ms
 * @param {string} [options.apiBaseUrl]  - Base URL for token API (for testing)
 * @returns {Promise<Finding[]>}
 */
export async function checkAuth(options = {}) {
  const { proxyUrl, timeout = 10000, apiBaseUrl = 'https://percy.io' } = options;
  const findings = [];
  const token = process.env.PERCY_TOKEN?.trim();

  // 1. Presence check
  if (!token) {
    findings.push({
      code: 'PERCY-DR-001',
      status: 'fail',
      message: 'PERCY_TOKEN is not set.',
      suggestions: [
        'Set PERCY_TOKEN in your environment: export PERCY_TOKEN=<your-token>',
        'Get your token from: https://percy.io → Project Settings → API Token',
        'In CI, add PERCY_TOKEN as a secret environment variable.'
      ]
    });
    return findings;
  }

  // 2. Format validation — report type only, NEVER the prefix or token value
  const prefix = token.split('_')[0];
  const projectType = KNOWN_PREFIXES[prefix] || 'web';
  const suggestedCmd = COMMAND_BY_TYPE[projectType] || COMMAND_BY_TYPE.default;

  findings.push({
    code: 'PERCY-DR-002',
    status: 'info',
    message: `Token detected (project type: ${projectType}). Use \`${suggestedCmd}\` to run snapshots.`,
    metadata: { tokenType: projectType }
  });

  // 3. Authentication test — use HttpProber, NOT @percy/client
  //    GET /api/v1/tokens validates the token:
  //    - 401 = token is invalid/expired
  //    - 403 = token is valid (authenticated) but project-scoped (not user token)
  //    - 200 = token is a valid user master token
  try {
    const result = await httpProber.probeUrl(
      `${apiBaseUrl}/api/v1/tokens`,
      {
        proxyUrl,
        timeout,
        method: 'GET',
        headers: { Authorization: `Token token=${token}` }
      }
    );

    const status = result.status;

    if (status === 200 || status === 403) {
      // 200 = user token, 403 = valid project token (endpoint requires user token)
      // Both confirm the token is authenticated
      findings.push({
        code: 'PERCY-DR-003',
        status: 'pass',
        message: 'Token authentication successful.'
      });
    } else if (status === 401) {
      findings.push({
        code: 'PERCY-DR-004',
        status: 'fail',
        message: 'Token authentication failed (HTTP 401 Unauthorized).',
        suggestions: [
          'Your token may be expired, revoked, or incorrectly copied.',
          'Get a new token from: https://percy.io → Project Settings → API Token',
          'Ensure the full token is set (no truncation from copy-paste).'
        ]
      });
    } else if (result.ok === false && result.status === 0) {
      // Network error — couldn't reach the API at all
      findings.push({
        code: 'PERCY-DR-006',
        status: 'warn',
        message: `Token auth check could not reach Percy API: ${sanitizeError(result.error)}`,
        suggestions: [
          'This may be a network issue rather than a token issue.',
          'See the Connectivity and Proxy sections for network diagnostics.'
        ]
      });
    } else {
      // Unexpected status code
      findings.push({
        code: 'PERCY-DR-005',
        status: 'warn',
        message: `Token auth returned unexpected HTTP ${status}.`,
        suggestions: [
          'This may indicate a Percy API issue. Try again later.',
          'If persistent, contact Percy support with this diagnostic output.'
        ]
      });
    }
  } catch (err) {
    findings.push({
      code: 'PERCY-DR-006',
      status: 'warn',
      message: `Token auth check could not reach Percy API: ${sanitizeError(err.message)}`,
      suggestions: [
        'This may be a network issue rather than a token issue.',
        'See the Connectivity and Proxy sections for network diagnostics.'
      ]
    });
  }

  return findings;
}
