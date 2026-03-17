import { httpProber } from '../utils/http.js';

// Strip raw token value from error messages to prevent credential leakage.
// Uses split/join instead of replaceAll for Node.js 14 compatibility.
function sanitizeError(msg) {
  /* istanbul ignore next */
  if (!msg) return msg;
  let sanitized = msg.replace(/Token token=[^\s,;)']*/gi, 'Token token=***');
  /* istanbul ignore next */
  const token = process.env.PERCY_TOKEN?.trim();
  /* istanbul ignore next */
  if (token) sanitized = sanitized.split(token).join('***');
  return sanitized;
}

// Role-based command suggestions.
// Roles returned by /api/v1/token: master, read_only, write_only
const ROLE_COMMAND = {
  app: 'percy app:exec'
};

function commandForType(projectTokenType) {
  return ROLE_COMMAND[projectTokenType] ?? 'percy exec';
}

function roleSummary(role) {
  switch (role) {
    case 'master':
      return 'master — full access (create builds, read results, manage project)';
    case 'read_only':
      return 'read_only — read-only access — can view results but cannot create builds';
    case 'write_only':
      return 'write_only — write-only access — can create builds but cannot read existing results';
    default:
      return `role: ${role}`;
  }
}

/**
 * Validate PERCY_TOKEN presence and authenticate against the Percy API.
 * Uses GET /api/v1/token to obtain token type and role directly from the API —
 * no client-side prefix splitting required.
 *
 * @param {object} [options]
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

  // 2. Authentication test — GET /api/v1/token returns type + role on 200,
  //    401 for invalid/expired token, 403 for forbidden.
  try {
    const result = await httpProber.probeUrl(
      `${apiBaseUrl}/api/v1/tokens/details`,
      {
        proxyUrl,
        timeout,
        method: 'GET',
        headers: { Authorization: `Token token=${token}` }
      }
    );

    const httpStatus = result.status;

    if (httpStatus === 200) {
      // Parse project-token-type and role from response body
      let projectTokenType = 'unknown';
      let role = 'unknown';
      try {
        /* istanbul ignore next */
        const body = typeof result.body === 'string'
          ? JSON.parse(result.body)
          /* istanbul ignore next */
          : result.body;
        /* istanbul ignore next */
        projectTokenType = body?.data?.attributes?.['project-token-type'] ?? 'unknown';
        /* istanbul ignore next */
        role = body?.data?.attributes?.role ?? 'unknown';
      } catch {
        // Malformed JSON — leave defaults, still a pass
      }

      const cmd = commandForType(projectTokenType);

      // DR-002: token type info (NEVER emit the token value)
      findings.push({
        code: 'PERCY-DR-002',
        status: 'info',
        message: `Token type: ${projectTokenType}. Use \`${cmd}\` to run snapshots.`,
        metadata: { projectTokenType, role }
      });

      // DR-003: authentication pass with role messaging
      const roleDesc = roleSummary(role);
      let passMsg = `Token authentication successful — ${roleDesc}.`;
      const suggestions = [];
      if (role === 'read_only') {
        suggestions.push('This token cannot create Percy builds. Use a master or write_only token in CI.');
      } else if (role === 'write_only') {
        suggestions.push('This token can create builds but cannot read results via the API.');
      }

      findings.push({
        code: 'PERCY-DR-003',
        status: 'pass',
        message: passMsg,
        ...(suggestions.length > 0 && { suggestions })
      });
    } else if (httpStatus === 401) {
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
    } else if (httpStatus === 403) {
      findings.push({
        code: 'PERCY-DR-004',
        status: 'fail',
        message: 'Token access denied (HTTP 403 Forbidden).',
        suggestions: [
          'The token may exist but is not authorized for this operation.',
          'Verify you are using the correct token for your project.',
          'Get your token from: https://percy.io → Project Settings → API Token'
        ]
      });
    } else if (!httpStatus || httpStatus === 0) {
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
        message: `Token auth returned unexpected HTTP ${httpStatus}.`,
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
