import fs from 'fs';
import path from 'path';
import readline from 'readline';
import os from 'os';
import { createRequire } from 'module';
import command from '@percy/cli-command';
import { checkSSL, applyConfigFix } from './checks/ssl.js';
import { checkConnectivity } from './checks/connectivity.js';
import { detectProxy } from './checks/proxy.js';
import { detectPAC } from './checks/pac.js';
import { checkBrowserNetwork } from './checks/browser.js';
import {
  sectionHeader,
  checkLine,
  suggestionList,
  summaryBanner,
  renderFindings,
  sectionStatus,
  print
} from './utils/reporter.js';

// Read the @percy/cli version for the JSON report (best-effort)
function getPercyCLIVersion() {
  try {
    const require = createRequire(import.meta.url);
    const pkg = require('@percy/cli/package.json');
    return pkg.version ?? 'unknown';
  } catch {
    try {
      const require = createRequire(import.meta.url);
      const pkg = require('../../cli/package.json');
      return pkg.version ?? 'unknown';
    } catch {
      return 'unknown';
    }
  }
}

// Hostnames that must be reachable for Percy builds to succeed.
// Only these count toward the browser check pass/fail — 3rd-party domains
// (ads, analytics, social) being blocked is normal and irrelevant.
const PERCY_DOMAINS = new Set([
  'percy.io',
  'www.browserstack.com',
  'hub.browserstack.com'
]);

export const doctor = command(
  'doctor',
  {
    description:
      'Diagnose network connectivity and configuration for Percy builds',

    examples: [
      '$0',
      '$0 --proxy-server http://proxy.corp.example.com:8080',
      '$0 --url https://my-staging.example.com',
      '$0 --output-json ./percy-doctor.json'
    ],

    flags: [
      {
        name: 'proxy-server',
        description:
          'Proxy server URL to test alongside direct connectivity (e.g. http://proxy:8080)',
        type: 'string',
        attribute: 'proxyServer'
      },
      {
        name: 'url',
        description:
          'URL to open in Chrome for network activity analysis (default: https://percy.io)',
        type: 'string'
      },
      {
        name: 'timeout',
        description: 'Per-request timeout in milliseconds (default: 10000)',
        type: 'string',
        default: '10000'
      },
      {
        name: 'fix',
        description:
          'Automatically apply suggested Percy config fixes when possible',
        type: 'boolean',
        default: false
      },
      {
        name: 'output-json',
        description:
          'Write the full diagnostic report to a JSON file (default: percy-doctor-report.json)',
        type: 'string',
        attribute: 'outputJson'
      }
    ]
  },
  async ({ flags, log, exit }) => {
    const proxyUrl =
      flags.proxyServer ||
      process.env.HTTPS_PROXY ||
      process.env.https_proxy ||
      process.env.HTTP_PROXY ||
      process.env.http_proxy ||
      null;

    const timeout = parseInt(flags.timeout ?? '10000', 10);
    const targetUrl = flags.url?.trim() || 'https://percy.io';
    const autoFix = flags.fix;

    // Always write a JSON report; --output-json overrides the filename.
    const jsonOutputPath = flags.outputJson || 'percy-doctor-report.json';

    const tally = { pass: 0, warn: 0, fail: 0 };

    // Accumulate structured report for JSON output
    const report = {
      timestamp: new Date().toISOString(),
      environment: {
        percyCLIVersion: getPercyCLIVersion(),
        platform: process.platform,
        arch: process.arch,
        nodeVersion: process.version,
        hostname: os.hostname(),
        proxyEnv: captureProxyEnv()
      },
      checks: {}
    };

    print(log, '\n  Percy Doctor — network readiness check\n');

    if (proxyUrl) {
      print(log, checkLine('info', `Proxy in use: ${proxyUrl}`));
      print(log, '');
    }

    // ══════════════════════════════════════════════════════════════════════════
    // 1. Percy.io Reachability
    //    Quick connectivity check to key Percy/BrowserStack domains.
    //    Run this first — if we can't reach the network at all, the other
    //    checks will give misleading context.
    // ══════════════════════════════════════════════════════════════════════════
    print(log, sectionHeader('Network Connectivity'));

    let connFindings = [];
    try {
      connFindings = await checkConnectivity({ proxyUrl, timeout });
      renderFindings(connFindings, log, tally);
    } catch (err) {
      log.error(`Connectivity check failed unexpectedly: ${err.message}`);
      tally.fail++;
      connFindings = [{ status: 'fail', message: err.message }];
    }
    report.checks.connectivity = {
      status: sectionStatus(connFindings),
      findings: connFindings
    };

    // ══════════════════════════════════════════════════════════════════════════
    // 2. SSL / TLS
    //    Detect certificate issues and NODE_TLS_REJECT_UNAUTHORIZED overrides.
    // ══════════════════════════════════════════════════════════════════════════
    print(log, sectionHeader('SSL / TLS'));

    let sslFindings = [];
    try {
      sslFindings = await checkSSL({ proxyUrl, timeout });
      renderFindings(sslFindings, log, tally);

      // Offer to auto-apply config fix for SSL errors
      const sslFail = sslFindings.find(
        (f) => f.status === 'fail' && f.configFix
      );
      if (sslFail?.configFix) {
        if (autoFix) {
          const patched = applyConfigFix(
            process.cwd(),
            sslFail.configFix.key,
            sslFail.configFix.value
          );
          if (patched) {
            print(log, checkLine('pass', `Applied config fix to ${patched}`));
          } else {
            print(
              log,
              checkLine(
                'info',
                'Could not auto-apply config fix (YAML config not found or key already set).'
              )
            );
          }
        } else {
          print(
            log,
            checkLine(
              'info',
              'Tip: Run with --fix to automatically patch your Percy config, or add the following to your .percy.yml:'
            )
          );
          print(
            log,
            `      ${sslFail.configFix.key}: ${JSON.stringify(sslFail.configFix.value)}`
          );

          if (process.stdout.isTTY && !process.env.CI) {
            await promptConfigFix(sslFail.configFix);
          }
        }
      }
    } catch (err) {
      log.error(`SSL check failed unexpectedly: ${err.message}`);
      tally.fail++;
      sslFindings = [{ status: 'fail', message: err.message }];
    }
    report.checks.ssl = {
      status: sectionStatus(sslFindings),
      findings: sslFindings
    };

    // ══════════════════════════════════════════════════════════════════════════
    // 3. Proxy Detection (6-layer analysis)
    //    env vars → system settings → header fingerprinting → port scan →
    //    process inspection → WPAD
    // ══════════════════════════════════════════════════════════════════════════
    print(log, sectionHeader('Proxy Configuration'));

    let proxyFindings = [];
    try {
      proxyFindings = await detectProxy({ timeout, testProxy: true });
      renderFindings(proxyFindings, log, tally);
    } catch (err) {
      log.error(`Proxy detection failed unexpectedly: ${err.message}`);
      tally.fail++;
      proxyFindings = [{ status: 'fail', message: err.message }];
    }
    report.checks.proxy = {
      status: sectionStatus(proxyFindings),
      findings: proxyFindings
    };

    // ══════════════════════════════════════════════════════════════════════════
    // 4. PAC / Auto-Proxy Configuration
    //    Detect PAC files from macOS, Linux, Windows, Chrome, Firefox.
    // ══════════════════════════════════════════════════════════════════════════
    print(log, sectionHeader('PAC / Auto-Proxy Configuration'));

    let pacFindings = [];
    try {
      pacFindings = await detectPAC();
      renderFindings(pacFindings, log, tally);

      const actionablePac = pacFindings.find((f) => f.detectedProxyUrl);
      if (actionablePac) {
        print(
          log,
          checkLine(
            'warn',
            'Action required: PAC file routes percy.io through a proxy.'
          )
        );
        print(
          log,
          suggestionList([
            `Add to your CI environment: HTTPS_PROXY=${actionablePac.detectedProxyUrl}`,
            `Or run: percy doctor --proxy-server ${actionablePac.detectedProxyUrl}`
          ])
        );
      }
    } catch (err) {
      log.error(`PAC detection failed unexpectedly: ${err.message}`);
      tally.fail++;
      pacFindings = [{ status: 'fail', message: err.message }];
    }
    report.checks.pac = {
      status: sectionStatus(pacFindings),
      findings: pacFindings
    };

    // ══════════════════════════════════════════════════════════════════════════
    // 5. Browser Network Analysis
    //    Launch Chrome via CDP, navigate to the target URL (or percy.io), and
    //    capture all network requests.  If --proxy-server was supplied, run
    //    the capture twice (direct + via proxy) and compare domain reachability.
    // ══════════════════════════════════════════════════════════════════════════
    print(log, sectionHeader('Browser Network Analysis'));
    print(
      log,
      checkLine(
        'info',
        `Opening ${targetUrl} in Chrome to capture network activity…`
      )
    );

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
        // Chrome was found. Show any capture error as an informational note,
        // then always render the domain table if data was captured.
        if (browserResult.error) {
          print(log, checkLine('info', `Browser capture note: ${browserResult.error}`));
        }

        // Build domain rows: Percy/BrowserStack critical ones first, then all others.
        // All detected domains are listed; only Percy ones count toward pass/fail.
        const allRows = browserResult.domainSummary ?? [];
        const percyRows = allRows.filter(d => PERCY_DOMAINS.has(d.hostname));
        const otherRows = allRows.filter(d => !PERCY_DOMAINS.has(d.hostname));
        const sortedRows = [...percyRows, ...otherRows];

        if (sortedRows.length) {
          print(log, '');
          print(log, '  Domains loaded by Chrome:');
          print(log, `  ${'─'.repeat(62)}`);
          print(log, `  ${'Hostname'.padEnd(40)} ${'Status'.padEnd(10)} HTTP`);
          print(log, `  ${'─'.repeat(62)}`);
          for (const d of sortedRows) {
            const directOk = d.direct?.reachable;
            const proxyOk = d.viaProxy?.reachable ?? null;
            const httpCode = String(d.direct?.sampleStatus ?? d.viaProxy?.sampleStatus ?? '—');
            const statusLabel = directOk
              ? 'reachable'
              : (proxyOk ? 'via proxy' : 'blocked');
            // Percy critical domains get coloured icons; others use dim info icon
            const isCritical = PERCY_DOMAINS.has(d.hostname);
            const icon = isCritical
              ? ({ pass: '✔', warn: '⚠', fail: '✖', skip: '–' }[d.status] ?? 'ℹ')
              : '·';
            const hostDisplay = d.hostname.length > 39
              ? d.hostname.slice(0, 37) + '…'
              : d.hostname;
            print(log, `  ${icon} ${hostDisplay.padEnd(39)} ${statusLabel.padEnd(10)} ${httpCode}`);
          }
          print(log, `  ${'─'.repeat(62)}`);
          if (otherRows.length) {
            print(log, `  · ${otherRows.length} other domain(s) loaded (3rd-party, not required for Percy).`);
          }
        }

        // Report proxy-indicating headers seen in browser traffic
        // proxyHeaders entries are already formatted "Header-Name: value" strings
        if (browserResult.proxyHeaders?.length) {
          print(log, '');
          print(log, checkLine('warn', 'Proxy-indicating headers seen in browser traffic:'));
          for (const h of browserResult.proxyHeaders.slice(0, 5)) {
            print(log, `      ${h}`);
          }
        }

        // Tally: only Percy/BrowserStack domains count toward pass/fail.
        // 3rd-party domains (ads, analytics, social scripts) being blocked is
        // normal and has no impact on Percy builds.
        const criticalBlocked = (browserResult.domainSummary ?? []).filter(
          d => PERCY_DOMAINS.has(d.hostname) && d.status === 'fail'
        );
        if (!allRows.length) {
          // Nothing captured — likely capture errored before any events fired
          tally.warn++;
          print(log, checkLine('warn', 'No network requests captured from Chrome.'));
        } else if (criticalBlocked.length === 0) {
          tally.pass++;
          print(log, checkLine('pass', 'Percy/BrowserStack domains are reachable from Chrome.'));
        } else {
          tally.fail++;
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

    // ══════════════════════════════════════════════════════════════════════════
    // Summary
    // ══════════════════════════════════════════════════════════════════════════
    print(log, summaryBanner(tally.pass, tally.warn, tally.fail));

    // ══════════════════════════════════════════════════════════════════════════
    // JSON Report
    // ══════════════════════════════════════════════════════════════════════════
    report.summary = {
      pass: tally.pass,
      warn: tally.warn,
      fail: tally.fail,
      overall: tally.fail > 0 ? 'fail' : tally.warn > 0 ? 'warn' : 'pass'
    };

    // Always write the JSON report (default: percy-doctor-report.json).
    try {
      const absPath = path.resolve(process.cwd(), jsonOutputPath);
      fs.writeFileSync(absPath, JSON.stringify(report, null, 2), 'utf8');
      print(log, checkLine('info', `Full report saved to: ${absPath}`));
    } catch (err) {
      log.warn(`Could not write JSON report: ${err.message}`);
    }

    if (tally.fail > 0) {
      exit(1, '', false);
    }
  }
);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function captureProxyEnv() {
  const keys = [
    'HTTPS_PROXY',
    'https_proxy',
    'HTTP_PROXY',
    'http_proxy',
    'ALL_PROXY',
    'all_proxy',
    'NO_PROXY',
    'no_proxy',
    'NODE_TLS_REJECT_UNAUTHORIZED',
    'NODE_EXTRA_CA_CERTS',
    'PERCY_BROWSER_EXECUTABLE'
  ];
  const out = {};
  for (const k of keys) {
    if (process.env[k] !== undefined) out[k] = process.env[k];
  }
  return out;
}

function promptConfigFix(configFix) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    rl.question(
      `  Apply fix (add ${configFix.key}: ${JSON.stringify(configFix.value)} to .percy.yml)? [y/N] `,
      (answer) => {
        rl.close();
        if (answer.trim().toLowerCase() === 'y') {
          const patched = applyConfigFix(
            process.cwd(),
            configFix.key,
            configFix.value
          );
          if (patched) {
            process.stdout.write(`  ✔ Patched ${patched}\n`);
          } else {
            process.stdout.write('  ─ Could not patch config automatically.\n');
          }
        }
        resolve();
      }
    );
  });
}

export default doctor;
