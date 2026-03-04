import { checkConnectivityAndSSL } from '../checks/connectivity.js';
import { detectProxy } from '../checks/proxy.js';
import { detectPAC } from '../checks/pac.js';
import { checkBrowserNetwork } from '../checks/browser.js';
import {
  sectionHeader,
  checkLine,
  suggestionList,
  renderFindings,
  sectionStatus,
  print
} from './reporter.js';

// Percy/BrowserStack hostnames that count toward the browser-check pass/fail.
// 3rd-party domains (ads, analytics, social) being blocked is normal and
// has no impact on Percy builds.
export const PERCY_DOMAINS = new Set([
  'percy.io',
  'www.browserstack.com',
  'hub.browserstack.com'
]);

// ─── Utility helpers ──────────────────────────────────────────────────────────

/**
 * Redact credentials (username:password) from a proxy URL so it can be safely
 * logged or written to reports without exposing secrets.
 * e.g. "http://user:pass@proxy.corp.com:8080" → "http://***:***@proxy.corp.com:8080"
 */
export function redactProxyUrl(rawUrl) {
  if (!rawUrl) return rawUrl;
  try {
    const u = new URL(rawUrl);
    if (u.username || u.password) {
      u.username = '***';
      u.password = '***';
    }
    return u.toString();
  } catch {
    return rawUrl;
  }
}

/**
 * Collect all proxy-related and Percy browser environment variables that are
 * currently set, returning them as a plain object for the JSON report.
 * Proxy URLs are redacted to avoid leaking credentials.
 */
export function captureProxyEnv() {
  const proxyKeys = [
    'HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy',
    'ALL_PROXY', 'all_proxy'
  ];
  const otherKeys = [
    'NO_PROXY', 'no_proxy',
    'NODE_TLS_REJECT_UNAUTHORIZED', 'NODE_EXTRA_CA_CERTS',
    'PERCY_BROWSER_EXECUTABLE'
  ];
  const out = {};
  for (const k of proxyKeys) {
    if (process.env[k] !== undefined) out[k] = redactProxyUrl(process.env[k]);
  }
  for (const k of otherKeys) {
    if (process.env[k] !== undefined) out[k] = process.env[k];
  }
  return out;
}

// ─── Section runners ──────────────────────────────────────────────────────────
// Each function receives a shared `ctx` object:
//   { log, tally, report, proxyUrl, timeout, targetUrl }
// It prints output, updates tally and report in-place, and returns nothing.

/**
 * Sections 1 + 2: Network Connectivity and SSL/TLS.
 *
 * Both checks probe percy.io; checkConnectivityAndSSL runs them sharing the
 * same request — no duplicate HTTP roundtrip in the common case.
 */
export async function runConnectivityAndSSL(ctx) {
  const { log, report, proxyUrl, timeout } = ctx;

  print(log, sectionHeader('Network Connectivity'));

  let connectivityFindings = [];
  let sslFindings = [];

  try {
    ({ connectivityFindings, sslFindings } = await checkConnectivityAndSSL({ proxyUrl, timeout }));
  } catch (err) {
    log.error(`Connectivity/SSL check failed unexpectedly: ${err.message}`);
    connectivityFindings = [{ status: 'fail', message: err.message }];
  }

  renderFindings(connectivityFindings, log);
  report.checks.connectivity = {
    status: sectionStatus(connectivityFindings),
    findings: connectivityFindings
  };

  // ── SSL / TLS ──────────────────────────────────────────────────────────────
  print(log, sectionHeader('SSL / TLS'));
  renderFindings(sslFindings, log);

  report.checks.ssl = {
    status: sectionStatus(sslFindings),
    findings: sslFindings
  };
}

/**
 * Section 3: Proxy Configuration
 * env vars → system settings → header fingerprinting → port scan →
 * process inspection → WPAD
 */
export async function runProxyCheck(ctx) {
  const { log, report, timeout } = ctx;

  print(log, sectionHeader('Proxy Configuration'));
  print(log, checkLine('info', 'Scanning for proxy configuration and validating discovered proxies...'));

  let proxyFindings = [];
  try {
    proxyFindings = await detectProxy({ timeout, testProxy: true });
  } catch (err) {
    log.error(`Proxy detection failed unexpectedly: ${err.message}`);
    proxyFindings = [{ status: 'fail', message: err.message }];
  }

  renderFindings(proxyFindings, log);
  report.checks.proxy = {
    status: sectionStatus(proxyFindings),
    findings: proxyFindings
  };
}

/**
 * Section 4: PAC / Auto-Proxy Configuration
 * Detects PAC files from macOS, Linux, Windows, Chrome, Firefox.
 */
export async function runPACCheck(ctx) {
  const { log, report } = ctx;

  print(log, sectionHeader('PAC / Auto-Proxy Configuration'));

  let pacFindings = [];
  try {
    pacFindings = await detectPAC();
  } catch (err) {
    log.error(`PAC detection failed unexpectedly: ${err.message}`);
    pacFindings = [{ status: 'fail', message: err.message }];
  }

  renderFindings(pacFindings, log);

  const actionablePac = pacFindings.find(f => f.detectedProxyUrl);
  if (actionablePac) {
    print(log, checkLine('warn', 'Action required: PAC file routes percy.io through a proxy.'));
    print(log, suggestionList([
      `Add to your CI environment: HTTPS_PROXY=${actionablePac.detectedProxyUrl}`,
      `Or run: percy doctor --proxy-server ${actionablePac.detectedProxyUrl}`
    ]));
  }

  report.checks.pac = {
    status: sectionStatus(pacFindings),
    findings: pacFindings
  };
}

/**
 * Section 5: Browser Network Analysis
 * Launches Chrome, navigates to targetUrl, captures all network activity.
 * If --proxy-server was supplied, runs the capture twice and compares.
 */
export async function runBrowserCheck(ctx) {
  const { log, report, targetUrl, proxyUrl, timeout } = ctx;

  print(log, sectionHeader('Browser Network Analysis'));
  if (proxyUrl) {
    print(log, checkLine('info', `Opening ${targetUrl} in Chrome — two runs: direct and via proxy (${redactProxyUrl(proxyUrl)})…`));
  } else {
    print(log, checkLine('info', `Opening ${targetUrl} in Chrome to capture network activity…`));
  }

  let browserResult = null;
  try {
    browserResult = await checkBrowserNetwork({
      targetUrl,
      proxyUrl,
      timeout: Math.max(timeout, 30000), // browsers need more time
      headless: true
    });

    if (!browserResult.chromePath) {
      // Chrome not found — non-fatal skip
      print(log, checkLine('warn', 'Chrome not found — skipping browser network analysis.'));
      print(log, suggestionList([
        'Install Google Chrome or set PERCY_BROWSER_EXECUTABLE to the path of a Chromium-based browser.',
        'npm install @percy/cli will install a bundled Chromium.'
      ]));
    } else {
      _renderBrowserResults(log, browserResult, proxyUrl);
    }
  } catch (err) {
    log.error(`Browser analysis failed unexpectedly: ${err.message}`);
    // Non-fatal — browser analysis is best-effort
  }

  report.checks.browser = browserResult
    ? {
        status: browserResult.error
          ? 'warn'
          : sectionStatus(
            (browserResult.domainSummary ?? [])
              .filter(d => PERCY_DOMAINS.has(d.hostname))
              .map(d => ({ status: d.status }))
          ),
        chromePath: browserResult.chromePath,
        targetUrl: browserResult.targetUrl,
        domainSummary: browserResult.domainSummary ?? [],
        proxyHeaders: browserResult.proxyHeaders ?? [],
        navMs: browserResult.navMs,
        error: browserResult.error ?? null
      }
    : { status: 'skip', error: 'Browser analysis not attempted' };
}

/**
 * Run all Percy doctor checks programmatically.
 * Can be imported and called from other Percy packages to diagnose network
 * connectivity issues on demand.
 *
 * @param {object}  [options]
 * @param {object}  options.log          - Percy logger instance
 * @param {string}  [options.proxyUrl]   - Proxy URL to test
 * @param {number}  [options.timeout]    - Per-request timeout ms (default: 10000)
 * @param {string}  [options.targetUrl]  - URL to open in Chrome (default: https://percy.io)
 * @returns {Promise<{ checks: object, hasFail: boolean, hasWarn: boolean }>}
 */
export async function runDiagnostics({ log, proxyUrl, timeout = 10000, targetUrl = 'https://percy.io' } = {}) {
  const report = { checks: {} };
  const ctx = { log, report, proxyUrl, timeout, targetUrl };
  await runConnectivityAndSSL(ctx);
  await runProxyCheck(ctx);
  await runPACCheck(ctx);
  await runBrowserCheck(ctx);
  const hasFail = Object.values(report.checks).some(c => c?.status === 'fail');
  const hasWarn = Object.values(report.checks).some(c => c?.status === 'warn');
  return { checks: report.checks, hasFail, hasWarn };
}

// ─── Private rendering helpers ────────────────────────────────────────────────

/**
 * Render the domain table, proxy-header list, and update the tally for the
 * browser section. Only Percy/BrowserStack domains count toward pass/fail.
 */
function _renderBrowserResults(log, browserResult, proxyUrl) {
  if (browserResult.error) {
    print(log, checkLine('info', `Browser capture note: ${browserResult.error}`));
  }

  const allRows = browserResult.domainSummary ?? [];
  const hasProxy = !!proxyUrl && allRows.some(d => d.viaProxy !== null);

  if (allRows.length) {
    print(log, '');
    if (hasProxy) {
      // ── Two-column table: Direct | Via Proxy ──────────────────────────────
      print(log, '  Domains loaded by Chrome (direct vs via proxy):');
      print(log, `  ${'─'.repeat(72)}`);
      print(log, `  ${'Hostname'.padEnd(35)} ${'Direct'.padEnd(12)} ${'Via Proxy'.padEnd(12)} HTTP`);
      print(log, `  ${'─'.repeat(72)}`);
      for (const d of allRows) {
        const directLabel = d.direct
          ? (d.direct.reachable ? 'reachable' : 'failed')
          : '—';
        const proxyLabel = d.viaProxy
          ? d.viaProxy.reachable
            ? 'reachable'
            : d.viaProxy.errors.some(e => /PROXY_AUTH|407/i.test(e))
              ? 'auth-required'
              : d.viaProxy.errors.some(e => /ERR_PROXY_CONNECTION_FAILED|ERR_TUNNEL_CONNECTION/i.test(e))
                ? 'no-proxy'
                : d.viaProxy.errors.some(e => /ERR_CERT|ERR_SSL|CERTIFICATE|TLS/i.test(e))
                  ? 'cert-error'
                  : d.viaProxy.blocked
                    ? 'blocked'
                    : d.viaProxy.sampleStatus != null && d.viaProxy.sampleStatus >= 400
                      ? `http-${d.viaProxy.sampleStatus}`
                      : 'failed'
          : '—';
        const httpCode = String(
          d.direct?.sampleStatus ?? d.viaProxy?.sampleStatus ?? '—'
        );
        const icon = { pass: '\u2714', warn: '\u26a0', fail: '\u2716', skip: '\u2013' }[d.status] ?? '\u2139';
        const hostDisplay = d.hostname.length > 34 ? d.hostname.slice(0, 32) + '\u2026' : d.hostname;
        print(log, `  ${icon} ${hostDisplay.padEnd(34)} ${directLabel.padEnd(12)} ${proxyLabel.padEnd(12)} ${httpCode}`);
      }
      print(log, `  ${'─'.repeat(72)}`);
    } else {
      // ── Single-column table: Status ───────────────────────────────────────
      print(log, '  Domains loaded by Chrome:');
      print(log, `  ${'─'.repeat(62)}`);
      print(log, `  ${'Hostname'.padEnd(40)} ${'Status'.padEnd(10)} HTTP`);
      print(log, `  ${'─'.repeat(62)}`);
      for (const d of allRows) {
        const statusLabel = d.direct?.reachable ? 'reachable' : 'blocked';
        const httpCode = String(d.direct?.sampleStatus ?? '—');
        const icon = { pass: '\u2714', warn: '\u26a0', fail: '\u2716', skip: '\u2013' }[d.status] ?? '\u2139';
        const hostDisplay = d.hostname.length > 39 ? d.hostname.slice(0, 37) + '\u2026' : d.hostname;
        print(log, `  ${icon} ${hostDisplay.padEnd(39)} ${statusLabel.padEnd(10)} ${httpCode}`);
      }
      print(log, `  ${'─'.repeat(62)}`);
    }
  }

  if (browserResult.proxyHeaders?.length) {
    print(log, '');
    print(log, checkLine('warn', 'Proxy-indicating headers seen in browser traffic:'));
    for (const h of browserResult.proxyHeaders.slice(0, 5)) {
      print(log, `      ${h}`);
    }
  }

  // Tally: only Percy/BrowserStack domains count.
  const criticalBlocked = allRows.filter(d => PERCY_DOMAINS.has(d.hostname) && d.status === 'fail');
  if (!allRows.length) {
    print(log, checkLine('warn', 'No network requests captured from Chrome.'));
  } else if (criticalBlocked.length === 0) {
    print(log, checkLine('pass', 'Percy/BrowserStack domains are reachable from Chrome.'));
  } else {
    print(log, checkLine('fail',
      `Percy domain(s) unreachable from Chrome: ${criticalBlocked.map(d => d.hostname).join(', ')}`
    ));
    print(log, suggestionList([
      proxyUrl
        ? 'Ensure the proxy allows outbound HTTPS to percy.io and browserstack.com.'
        : 'Set HTTPS_PROXY if you are behind a corporate proxy.',
      'Contact your network team to whitelist: percy.io, www.browserstack.com, hub.browserstack.com.'
    ]));
  }
}
