import { probeUrl, isSslError } from '../utils/http.js';

// Domains that Percy's infrastructure relies on
export const REQUIRED_DOMAINS = [
  { label: 'Percy API', url: 'https://percy.io' },
  { label: 'BrowserStack API', url: 'https://www.browserstack.com' },
  { label: 'BrowserStack Automate', url: 'https://hub.browserstack.com' },
  {
    label: 'Chromium download CDN',
    url: 'https://storage.googleapis.com',
    optional: true,
    onFail: [
      'Percy downloads Chromium from storage.googleapis.com for asset capture.',
      'If this is blocked, set PERCY_CHROMIUM_BASE_URL to an internal mirror: export PERCY_CHROMIUM_BASE_URL=https://your-mirror/chromium/'
    ]
  }
];

/**
 * Check 2 – Network Connectivity & IP Whitelisting
 *
 * For each required domain, attempts both HTTPS (and HTTP fallback) with and
 * without any caller-supplied proxy, then classifies the failure mode:
 *
 *   pass  → reachable
 *   warn  → reachable only via proxy (proxy required, domain whitelisting may help)
 *   fail  → unreachable even with proxy  → likely IP/domain whitelist needed
 *   fail  → SSL error                    → handled/reported separately by ssl.js
 *
 * @param {object}   [options]
 * @param {string}   [options.proxyUrl]   - Proxy to test alongside direct
 * @param {number}   [options.timeout]    - Per-request timeout ms (default 10 000)
 * @param {string[]} [options.extraUrls]  - Additional URLs supplied via CLI
 * @returns {Promise<Array<ConnectivityFinding>>}
 */
export async function checkConnectivity(options = {}) {
  const { proxyUrl, timeout = 10000, extraUrls = [] } = options;

  const targets = [
    ...REQUIRED_DOMAINS,
    ...extraUrls.map(u => ({ label: u, url: u }))
  ];

  // Separate optional domains (informational failures only)

  const findings = [];

  await Promise.all(targets.map(async ({ label, url, optional, onFail }) => {
    const finding = await _probeTarget(label, url, proxyUrl, timeout);
    // For optional domains (e.g. Chromium CDN), demote a fail to warn and
    // use the domain-specific onFail suggestions if provided.
    if (optional && finding.status === 'fail') {
      finding.status = 'warn';
      if (onFail) finding.suggestions = onFail;
    }
    findings.push(finding);
  }));

  // Sort: failures first, then warnings, then passes
  const order = { fail: 0, warn: 1, pass: 2, skip: 3 };
  findings.sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9));

  return findings;
}

// ─── Internal ────────────────────────────────────────────────────────────────

async function _probeTarget(label, url, proxyUrl, timeout) {
  const rejectUnauthorized = process.env.NODE_TLS_REJECT_UNAUTHORIZED !== '0';

  // Direct probe
  const direct = await probeUrl(url, { timeout, rejectUnauthorized });

  // Proxy probe (only if a proxy is configured)
  const viaProxy = proxyUrl
    ? await probeUrl(url, { proxyUrl, timeout, rejectUnauthorized })
    : null;

  // ── classify ──────────────────────────────────────────────────────────────

  // SSL errors are surfaced here too so the user sees them in context
  if (isSslError(direct)) {
    return {
      status: 'fail',
      label,
      url,
      directResult: direct,
      proxyResult: viaProxy,
      message: `SSL error for ${label} (${url}): ${direct.errorCode}`,
      suggestions: [
        'See the SSL / TLS section above for remediation steps.',
        'Ensure your network proxy is not performing SSL inspection on percy.io / browserstack.com.',
        'Temporary bypass: export NODE_TLS_REJECT_UNAUTHORIZED=0'
      ]
    };
  }

  // Any HTTP response (even 4xx/5xx) means the server is network-reachable.
  // Endpoints like hub.browserstack.com return 401/403 without credentials — that is still reachable.
  const directReachable = direct.ok || (direct.status > 0 && !direct.errorCode);
  const proxyReachable = viaProxy && (viaProxy.ok || (viaProxy.status > 0 && !viaProxy.errorCode));

  if (directReachable) {
    return {
      status: 'pass',
      label,
      url,
      directResult: direct,
      proxyResult: viaProxy,
      message: `${label} is reachable directly (HTTP ${direct.status}, ${direct.latencyMs}ms).`
    };
  }

  // Direct failed – check if proxy helps
  if (proxyReachable) {
    return {
      status: 'warn',
      label,
      url,
      directResult: direct,
      proxyResult: viaProxy,
      message: `${label} is reachable via proxy but NOT directly.`,
      suggestions: [
        `Ensure the proxy server is configured: set HTTPS_PROXY=${proxyUrl}`,
        'Add proxy settings to your Percy config file under the proxy key.',
        `Direct error: ${direct.errorCode ?? direct.error}`
      ]
    };
  }

  // Both direct and proxy failed (or no proxy configured)
  const failReason = _classifyConnFailure(direct);
  return {
    status: 'fail',
    label,
    url,
    directResult: direct,
    proxyResult: viaProxy,
    message: `${label} (${url}) is NOT reachable. ${failReason.reason}`,
    suggestions: failReason.suggestions
  };
}

function _classifyConnFailure(result) {
  switch (result.errorCode) {
    case 'ENOTFOUND':
      return {
        reason: 'DNS resolution failed.',
        suggestions: [
          'Check that percy.io / browserstack.com are not blocked by your DNS server.',
          'Try: nslookup percy.io  – if it fails, contact your network/IT team.',
          'Add percy.io and browserstack.com to your corporate DNS or firewall whitelist.'
        ]
      };
    case 'ECONNREFUSED':
      return {
        reason: 'Connection refused.',
        suggestions: [
          'The destination port may be blocked by your firewall.',
          'Ensure outbound HTTPS (port 443) traffic to percy.io is allowed.'
        ]
      };
    case 'ETIMEDOUT':
    case 'ECONNRESET':
      return {
        reason: 'Connection timed out or was reset.',
        suggestions: [
          'A firewall or proxy may be silently dropping packets to percy.io.',
          'Ensure percy.io (185.105.106.0/24) and browserstack.com are whitelisted.',
          'If behind a proxy, configure HTTPS_PROXY or --proxy-server flag.',
          'Try: curl -v https://percy.io  to diagnose manually.'
        ]
      };
    default:
      return {
        reason: result.error ?? result.errorCode,
        suggestions: [
          'Run with --verbose for more detail.',
          'Try: curl -v https://percy.io',
          'Ensure your network permits outbound HTTPS to percy.io and browserstack.com.'
        ]
      };
  }
}
