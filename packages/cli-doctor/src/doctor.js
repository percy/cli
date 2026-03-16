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
  runBrowserCheck
} from './utils/helpers.js';
import { checkLine, print } from './utils/reporter.js';

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

    const report = {
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

    print(log, '\n  Percy Doctor — network readiness check\n');
    if (proxyUrl) {
      print(log, checkLine('info', `Proxy in use: ${redactProxyUrl(proxyUrl)}`));
      print(log, '');
    }

    const { connectivity, ssl } = await runConnectivityAndSSL(proxyUrl, timeout);
    report.checks.connectivity = connectivity;
    report.checks.ssl = ssl;

    const { proxy } = await runProxyCheck(timeout);
    report.checks.proxy = proxy;

    const { pac } = await runPACCheck();
    report.checks.pac = pac;

    const { browser } = await runBrowserCheck(targetUrl, proxyUrl, timeout);
    report.checks.browser = browser;

    report.summary = {
      overall: Object.values(report.checks).some(c => c?.status === 'fail') ? 'fail'
        : Object.values(report.checks).some(c => c?.status === 'warn') ? 'warn' : 'pass'
    };

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
