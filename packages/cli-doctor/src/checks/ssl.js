import fs from 'fs';
import path from 'path';
import { probeUrl, isSslError } from '../utils/http.js';

const PERCY_HTTPS = 'https://percy.io';
const PERCY_HTTP = 'http://percy.io';

// Config file names percy supports
const CONFIG_FILENAMES = [
  '.percy.yml', '.percy.yaml',
  '.percy.js', '.percy.cjs',
  '.percy.json'
];

/**
 * Check 1 – SSL Configuration
 *
 * Detects:
 *  (a) NODE_TLS_REJECT_UNAUTHORIZED=0  (SSL disabled globally)
 *  (b) SSL certificate errors when connecting to percy.io
 *      (common with corporate MITM proxies / VPNs)
 *
 * Returns an array of finding objects:
 *   { status: 'pass'|'warn'|'fail', message, suggestions? }
 */
export async function checkSSL(options = {}) {
  const findings = [];

  // ── (a) NODE_TLS_REJECT_UNAUTHORIZED ──────────────────────────────────────
  if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0') {
    findings.push({
      status: 'warn',
      message: 'NODE_TLS_REJECT_UNAUTHORIZED=0 is set – SSL certificate verification is disabled.',
      suggestions: [
        'Remove NODE_TLS_REJECT_UNAUTHORIZED=0 from your environment once SSL issues are resolved.',
        'If you intentionally disabled SSL (e.g. self-signed corp cert), this is expected.'
      ]
    });
  }

  // ── (b) SSL probe to percy.io ─────────────────────────────────────────────
  const probe = await probeUrl(PERCY_HTTPS, {
    proxyUrl: options.proxyUrl,
    timeout: options.timeout ?? 10000,
    rejectUnauthorized: true // intentionally strict to surface SSL errors
  });

  if (isSslError(probe)) {
    const finding = {
      status: 'fail',
      message: `SSL error connecting to percy.io: ${probe.error} [${probe.errorCode}]`,
      suggestions: [
        'Your network proxy or VPN may be intercepting HTTPS traffic with its own certificate.',
        'Ask your network admin to add percy.io to the SSL inspection exclusion list.',
        'Temporary bypass: export NODE_TLS_REJECT_UNAUTHORIZED=0  (re-run percy doctor to verify)',
        'Or add to .percy.yml:  ssl:\n        rejectUnauthorized: false'
      ],
      configFix: {
        key: 'ssl.rejectUnauthorized',
        value: false,
        comment: 'Disable SSL verification (use only if required by your network)'
      }
    };
    findings.push(finding);
  } else if (!probe.ok && probe.errorCode !== 'ECONNREFUSED' && probe.status === 0) {
    // Network unreachable – not necessarily SSL, handled by connectivity check
    findings.push({
      status: 'skip',
      message: `Could not reach percy.io over HTTPS (${probe.errorCode ?? probe.error}). SSL check skipped – see connectivity check.`
    });
  } else {
    findings.push({
      status: 'pass',
      message: `SSL handshake with percy.io succeeded (${probe.latencyMs}ms).`
    });
  }

  return findings;
}

/**
 * Offer to patch the nearest Percy config file with a given key/value.
 * Returns the path that was written, or null if the user declined / not found.
 *
 * NOTE: This is a programmatic helper; interactive prompting is handled in
 * doctor.js using the CLI's readline.
 *
 * @param {string} cwd
 * @param {string} key   - dot-notation path e.g. 'ssl.rejectUnauthorized'
 * @param {*}      value
 * @returns {string|null}
 */
export function applyConfigFix(cwd, key, value) {
  // Find the nearest YAML config file (simplest, most common)
  let configPath = null;
  let dir = cwd;
  const root = path.parse(dir).root;

  while (dir !== root) {
    for (const name of CONFIG_FILENAMES) {
      const candidate = path.join(dir, name);
      if (fs.existsSync(candidate)) { configPath = candidate; break; }
    }
    if (configPath) break;
    dir = path.dirname(dir);
  }

  if (!configPath || !configPath.endsWith('.yml') && !configPath.endsWith('.yaml')) {
    return null; // Only patch YAML configs automatically
  }

  const content = fs.readFileSync(configPath, 'utf8');

  // Build the YAML snippet for the key
  // For 'ssl.rejectUnauthorized: false' → add under 'ssl:' block
  const parts = key.split('.');
  let snippet = '';
  for (let i = parts.length - 1; i >= 0; i--) {
    const indent = '  '.repeat(i);
    if (i === parts.length - 1) {
      const yamlValue = typeof value === 'boolean' ? String(value) : JSON.stringify(value);
      snippet = `${indent}${parts[i]}: ${yamlValue}`;
    } else {
      snippet = `${indent}${parts[i]}:\n${snippet}`;
    }
  }

  // Append snippet if it doesn't already exist
  if (!content.includes(parts[0] + ':')) {
    fs.writeFileSync(configPath, content.trimEnd() + '\n' + snippet + '\n', 'utf8');
    return configPath;
  }

  return null; // Key already exists; not patching automatically
}
