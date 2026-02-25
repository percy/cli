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
      'Percy downloads Chromium from storage.googleapis.com for visual asset capture.',
      'To fix: set PERCY_BROWSER_EXECUTABLE=/path/to/chrome to use an installed browser,',
      'or mirror the Chromium CDN: export PERCY_CHROMIUM_BASE_URL=https://your-mirror/chromium/'
    ]
  }
];

/**
 * Combined connectivity + SSL check.
 *
 * Runs all required-domain probes in parallel, then derives SSL findings from
 * the same percy.io probe result — avoiding a duplicate request in the common case.
 *
 * A separate strict SSL probe (rejectUnauthorized: true) is only issued when
 * NODE_TLS_REJECT_UNAUTHORIZED=0 is set, since in that case the main connectivity
 * probe uses rejectUnauthorized: false and cannot surface SSL certificate errors.
 *
 * @param {object}   [options]
 * @param {string}   [options.proxyUrl]   - Proxy to test alongside direct
 * @param {number}   [options.timeout]    - Per-request timeout ms (default 10 000)
 * @returns {Promise<{ connectivityFindings: Array, sslFindings: Array }>}
 */
export async function checkConnectivityAndSSL(options = {}) {
  const { proxyUrl, timeout = 10000 } = options;

  const rawFindings = await Promise.all(REQUIRED_DOMAINS.map(async ({ label, url, optional, onFail }) => {
    const finding = await _probeTarget(label, url, proxyUrl, timeout);
    if (optional && finding.status === 'fail') {
      finding.status = 'warn';
      if (onFail) finding.suggestions = onFail;
    }
    return finding;
  }));

  // Sort: failures first, then warnings, then passes
  const order = { fail: 0, warn: 1, pass: 2, skip: 3 };
  rawFindings.sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9));

  // Reuse the percy.io connectivity probe result for the SSL check — no extra
  // HTTP round-trip needed.
  const percyFinding = rawFindings.find(f => f.url === 'https://percy.io');
  const sslFindings = _buildSSLFindings(percyFinding?.directResult);

  return { connectivityFindings: rawFindings, sslFindings };
}

/**
 * Backward-compatible wrapper — returns only connectivity findings.
 * Existing callers and tests that do not need SSL findings can use this.
 */
export async function checkConnectivity(options = {}) {
  const { connectivityFindings } = await checkConnectivityAndSSL(options);
  return connectivityFindings;
}

// ─── Internal ────────────────────────────────────────────────────────────────

/**
 * Build SSL findings from a percy.io probe result.
 * Mirrors the ssl.js checkSSL() logic, but reuses an existing probe result
 * rather than issuing a new HTTP request.
 */
function _buildSSLFindings(percyProbeResult) {
  const findings = [];

  // (a) NODE_TLS_REJECT_UNAUTHORIZED env var warning
  if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0') {
    findings.push({
      status: 'warn',
      message: 'NODE_TLS_REJECT_UNAUTHORIZED=0 is set – SSL certificate verification is disabled.',
      suggestions: [
        'Remove NODE_TLS_REJECT_UNAUTHORIZED=0 from your environment once SSL issues are resolved.',
        'If you intentionally disabled SSL (e.g. self-signed corp cert), this is expected.',
        'Note: percy doctor mirrors this to Chrome (--ignore-certificate-errors) so browser captures also bypass SSL.'
      ]
    });
  }

  // (b) SSL probe result derived from the connectivity probe
  if (!percyProbeResult) {
    findings.push({ status: 'skip', message: 'SSL check skipped — percy.io was not probed.' });
    return findings;
  }

  if (isSslError(percyProbeResult)) {
    findings.push({
      status: 'fail',
      message: `SSL error connecting to percy.io: ${percyProbeResult.error} [${percyProbeResult.errorCode}]`,
      suggestions: [
        'Your network proxy or VPN may be intercepting HTTPS traffic with its own certificate.',
        'Ask your network admin to add percy.io to the SSL inspection exclusion list.',
        'Temporary bypass: export NODE_TLS_REJECT_UNAUTHORIZED=0  (re-run percy doctor to verify)',
        'Or trust the proxy CA: export NODE_EXTRA_CA_CERTS=/path/to/proxy-ca.crt'
      ]
    });
  } else if (!percyProbeResult.ok && percyProbeResult.errorCode !== 'ECONNREFUSED' && percyProbeResult.status === 0) {
    findings.push({
      status: 'skip',
      message: `Could not reach percy.io over HTTPS (${percyProbeResult.errorCode ?? percyProbeResult.error}). SSL check skipped – see connectivity check.`
    });
  } else {
    findings.push({
      status: 'pass',
      message: `SSL handshake with percy.io succeeded (${percyProbeResult.latencyMs}ms).`
    });
  }

  return findings;
}

async function _probeTarget(label, url, proxyUrl, timeout) {
  // Direct probe — Node honours NODE_TLS_REJECT_UNAUTHORIZED automatically
  const direct = await probeUrl(url, { timeout });

  // Proxy probe (only if a proxy is configured)
  const viaProxy = proxyUrl
    ? await probeUrl(url, { proxyUrl, timeout })
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
