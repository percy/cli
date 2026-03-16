import fs from 'fs';
import path from 'path';
import os from 'os';
import command from '@percy/cli-command';
import {
  captureProxyEnv,
  redactProxyUrl,
  runConnectivityAndSSL,
  runProxyCheck,
  runPACCheck,
  runBrowserCheck,
  runAuthCheck,
  runConfigCheck,
  runCICheck
} from './utils/helpers.js';
import { checkLine, summaryBanner, print } from './utils/reporter.js';

import { getPackageJSON } from '@percy/cli-command/utils';
const pkg = getPackageJSON(import.meta.url);

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
        name: 'output-json',
        description:
          'Write the full diagnostic report to a JSON file',
        type: 'string',
        attribute: 'outputJson'
      }
    ]
  },
  async ({ flags, log, exit }) => {
    const startTime = Date.now();
    const proxyUrl =
      flags.proxyServer ||
      process.env.HTTPS_PROXY ||
      process.env.https_proxy ||
      process.env.HTTP_PROXY ||
      process.env.http_proxy ||
      null;

    const timeout = parseInt(flags.timeout ?? '10000', 10);
    if (isNaN(timeout) || timeout <= 0) {
      log.error('--timeout must be a positive integer (milliseconds)');
      return exit(1, '--timeout must be a positive integer', false);
    }
    const targetUrl = flags.url?.trim() || 'https://percy.io';
    const jsonOutputPath = flags.outputJson ?? null;

    // Inter-check context — plain object, not a class
    const ctx = {
      proxyUrl,
      timeout,
      targetUrl,
      discoveredProxies: [],
      connectivityOk: null,
      pacResolvedProxy: null,
      get bestProxy() {
        return this.proxyUrl || this.discoveredProxies[0]?.url || this.pacResolvedProxy || null;
      }
    };

    const report = {
      version: '1.0.0',
      timestamp: new Date().toISOString(),
      environment: {
        percyCLIVersion: pkg.version,
        platform: process.platform,
        arch: process.arch,
        nodeVersion: process.version,
        hostname: os.hostname(),
        proxyEnv: captureProxyEnv()
      },
      checks: {}
    };

    print(log, '\n  Percy Doctor — diagnostic check\n');
    if (proxyUrl) {
      print(log, checkLine('info', `Proxy in use: ${redactProxyUrl(proxyUrl)}`));
      print(log, '');
    }

    // Phase 1: Independent checks (parallel with allSettled)
    const phase1Results = await Promise.allSettled([
      runConfigCheck(),
      runCICheck()
    ]);
    report.checks.config = phase1Results[0].status === 'fulfilled'
      ? phase1Results[0].value.config
      : { status: 'fail', findings: [{ status: 'fail', message: phase1Results[0].reason?.message }] };
    report.checks.ci = phase1Results[1].status === 'fulfilled'
      ? phase1Results[1].value.ci
      : { status: 'fail', findings: [{ status: 'fail', message: phase1Results[1].reason?.message }] };

    // Phase 2: Network checks (sequential — order matters for output readability)
    const { connectivity, ssl } = await runConnectivityAndSSL(proxyUrl, timeout);
    report.checks.connectivity = connectivity;
    report.checks.ssl = ssl;
    ctx.connectivityOk = connectivity.status !== 'fail';

    const { proxy } = await runProxyCheck(timeout);
    report.checks.proxy = proxy;
    ctx.discoveredProxies = (proxy.findings ?? [])
      .filter(f => f.proxyUrl && f.proxyValidation?.status === 'pass')
      .map(f => ({ url: f.proxyUrl, source: f.source }));

    const { pac } = await runPACCheck();
    report.checks.pac = pac;
    ctx.pacResolvedProxy = (pac.findings ?? []).find(f => f.detectedProxyUrl)?.detectedProxyUrl ?? null;

    // Phase 3: Token auth (depends on connectivity + proxy discovery)
    const { auth } = await runAuthCheck(ctx);
    report.checks.auth = auth;

    // Phase 4: Browser network analysis
    const { browser } = await runBrowserCheck(targetUrl, ctx.bestProxy, timeout);
    report.checks.browser = browser;

    const counts = { passed: 0, warned: 0, failed: 0 };
    for (const c of Object.values(report.checks)) {
      if (c?.status === 'pass') counts.passed++;
      else if (c?.status === 'warn') counts.warned++;
      else if (c?.status === 'fail') counts.failed++;
    }

    report.summary = {
      overall: counts.failed > 0 ? 'fail' : counts.warned > 0 ? 'warn' : 'pass',
      passed: counts.passed,
      warned: counts.warned,
      failed: counts.failed,
      durationMs: Date.now() - startTime
    };

    print(log, summaryBanner(counts.passed, counts.warned, counts.failed));
    print(log, `  Completed in ${((Date.now() - startTime) / 1000).toFixed(1)}s\n`);

    if (jsonOutputPath) {
      try {
        // cli-doctor runs inside the customer's own CI environment; jsonOutputPath is a
        // CLI flag value supplied by the operator, not arbitrary remote user input.
        // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
        const absPath = path.resolve(process.cwd(), jsonOutputPath);
        fs.writeFileSync(absPath, JSON.stringify(report, null, 2), 'utf8');
        print(log, checkLine('info', `Full report saved to: ${absPath}`));
      } catch (err) {
        log.warn(`Could not write JSON report: ${err.message}`);
      }
    }

    if (report.summary.overall === 'fail') {
      exit(1, '', false);
    }
  }
);

export default doctor;
