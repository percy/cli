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
 * the same percy.io probe result — no duplicate HTTP roundtrip.
 *
 * @param {object}   [options]
 * @param {string}   [options.proxyUrl]   - Proxy to test alongside direct
 * @param {number}   [options.timeout]    - Per-request timeout ms (default 10 000)
 * @returns {Promise<{ connectivityFindings: Array, sslFindings: Array }>}
 */
export async function checkConnectivityAndSSL(options = {}) {
  const { proxyUrl, timeout = 10000, _domains = REQUIRED_DOMAINS, _percyUrl = 'https://percy.io', _probeUrl: probeUrlFn = probeUrl } = options;

  const rawFindings = await Promise.all(_domains.map(async ({ label, url, optional, onFail }) => {
    const finding = await _probeTarget(label, url, proxyUrl, timeout, probeUrlFn);
    if (optional && finding.status === 'fail') {
      finding.status = 'warn';
      if (onFail) finding.suggestions = onFail;
    }
    return finding;
  }));

  // Sort: failures first, then warnings, then passes
  const order = { fail: 0, warn: 1, pass: 2, skip: 3 };
  /* istanbul ignore next */
  rawFindings.sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9));

  // Reuse the percy.io connectivity probe result for the SSL check — no extra
  // HTTP round-trip needed.
  // _percyUrl is overridable in tests so we can point it at a local server.
  const percyFinding = rawFindings.find(f => f.url === _percyUrl);
  const sslFindings = _buildSSLFindings(percyFinding?.directResult);

  return { connectivityFindings: rawFindings, sslFindings };
}

/**
 * Build SSL findings from a percy.io probe result.
 * Mirrors the ssl.js checkSSL() logic, but reuses an existing probe result
 * rather than issuing a new HTTP request.
 */
export function _buildSSLFindings(percyProbeResult) {
  const findings = [];

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
        'Solution: export NODE_TLS_REJECT_UNAUTHORIZED=0  (re-run percy doctor to verify)',
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

async function _probeTarget(label, url, proxyUrl, timeout, probeUrlFn) {
  // Direct probe — Node honours NODE_TLS_REJECT_UNAUTHORIZED automatically
  const direct = await probeUrlFn(url, { timeout });

  // Proxy probe (only if a proxy is configured)
  const viaProxy = proxyUrl
    ? await probeUrlFn(url, { proxyUrl, timeout })
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
        'Solution: export NODE_TLS_REJECT_UNAUTHORIZED=0'
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
  return {
    status: 'fail',
    label,
    url,
    directResult: direct,
    proxyResult: viaProxy,
    message: `${label} (${url}) is NOT reachable.`,
    suggestions: [
      `Ensure your network allows outbound HTTPS to ${new URL(url).hostname}.`,
      'Contact your network/IT team to whitelist: percy.io, www.browserstack.com, hub.browserstack.com.',
      'If behind a corporate proxy, set HTTPS_PROXY=http://proxy-host:port in your environment.'
    ]
  };
}
