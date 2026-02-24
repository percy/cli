import { execSync, exec as execCb } from 'child_process';
import { promisify } from 'util';
import net from 'net';
import dns from 'dns';
import fs from 'fs';
import os from 'os';
import { probeUrl } from '../utils/http.js';

const exec = promisify(execCb);

// ─── Proxy environment variable names (case-insensitive handled below) ───────
const PROXY_ENV_KEYS = [
  'HTTPS_PROXY', 'https_proxy',
  'HTTP_PROXY', 'http_proxy',
  'ALL_PROXY', 'all_proxy'
];
const NO_PROXY_KEYS = ['NO_PROXY', 'no_proxy'];

// Common proxy ports to scan on localhost and default gateway
const PROXY_PORTS = [3128, 8080, 8443, 8888, 9090, 1080, 3000, 8118, 6588];

// Process names that indicate a proxy or security agent
const PROXY_PROCESS_PATTERNS = [
  'zscaler', 'zsatunnel', 'zsaservice',
  'netskope', 'nssvc',
  'symantec', 'bluecoat', 'proxysg',
  'crowdstrike', 'falcon',
  'squid', 'tinyproxy', 'privoxy',
  'charles', 'fiddler', 'mitmproxy', 'proxyman',
  'burp', 'owasp',
  'forticlient',
  'anyconnect',
  'globalprotect', 'pangps',
  'networkserviceproxy',
  'iboss', 'mcafee web gateway'
];

// Response-header names that indicate a proxy is in the path
const PROXY_HEADER_INDICATORS = [
  'via',
  'x-forwarded-for',
  'x-forwarded-host',
  'x-forwarded-proto',
  'x-real-ip',
  'forwarded',
  'x-proxy-id',
  'x-bluecoat-via',
  'x-egress-zone',
  'x-zscaler-request-id',
  'x-netskope-user',
  'x-proxyuser-ip',
  'proxy-connection'
];

/**
 * Check 3 – Thorough Proxy Detection
 *
 * Detection layers:
 *   1. Environment variables (HTTPS_PROXY, HTTP_PROXY, ALL_PROXY, NO_PROXY)
 *   2. System-level settings (macOS scutil, Linux gsettings, Windows registry)
 *   3. Response-header fingerprinting (Via, X-Forwarded-For, Proxy-* etc.)
 *   4. Common-port scanning on localhost and default gateway
 *   5. System process inspection for known proxy/security agents
 *   6. WPAD / DNS auto-discovery
 *
 * @param {object}  [options]
 * @param {number}  [options.timeout]         Request timeout ms
 * @param {boolean} [options.testProxy]       Validate discovered proxies
 * @param {boolean} [options.scanPorts]       Scan common proxy ports on localhost/gateway
 * @param {boolean} [options.checkHeaders]    Fingerprint via HTTP response headers
 * @param {boolean} [options.scanProcesses]   Inspect running process list
 * @param {boolean} [options.checkWpad]       Test WPAD DNS resolution
 * @returns {Promise<ProxyFinding[]>}
 */
export async function detectProxy(options = {}) {
  const {
    timeout = 10000,
    testProxy = true,
    scanPorts = true,
    checkHeaders = true,
    scanProcesses = true,
    checkWpad = true
  } = options;

  const findings = [];
  const discovered = new Map(); // proxyUrl → { source, confidence }

  // ── Layer 1: Environment variables ────────────────────────────────────────
  for (const key of PROXY_ENV_KEYS) {
    const val = process.env[key];
    if (val) discovered.set(val, { source: `env:${key}`, confidence: 'definite' });
  }

  const noProxy = NO_PROXY_KEYS.map(k => process.env[k]).filter(Boolean).join(',');
  if (noProxy) {
    findings.push({
      status: 'info',
      layer: 'environment',
      source: 'env:NO_PROXY',
      message: `NO_PROXY / no_proxy is set: ${noProxy}`,
      proxyUrl: null,
      suggestions: [
        'Ensure percy.io and browserstack.com are NOT in NO_PROXY if you need the proxy to reach them.'
      ]
    });
  }

  // ── Layer 2: System-level proxy config ────────────────────────────────────
  const platform = os.platform();
  if (platform === 'darwin') {
    const sys = detectMacOSProxy();
    if (sys) discovered.set(sys.url, { source: sys.source, confidence: 'definite' });
  } else if (platform === 'linux') {
    const sys = detectLinuxProxy();
    if (sys) discovered.set(sys.url, { source: sys.source, confidence: 'definite' });
  } else if (platform === 'win32') {
    const sys = detectWindowsProxy();
    if (sys) discovered.set(sys.url, { source: sys.source, confidence: 'definite' });
  }

  // ── Layer 3: Response-header fingerprinting ────────────────────────────────
  const headerFindings = checkHeaders ? await detectViaHeaders(timeout) : [];
  for (const hf of headerFindings) {
    findings.push(hf);
    if (hf.detectedProxyUrl) {
      discovered.set(hf.detectedProxyUrl, { source: 'header-fingerprint', confidence: 'likely' });
    }
  }

  // ── Layer 4: Common-port scan ─────────────────────────────────────────────
  const portFindings = scanPorts ? await scanProxyPorts(timeout) : [];
  for (const pf of portFindings) {
    findings.push(pf);
    if (pf.proxyUrl && !discovered.has(pf.proxyUrl)) {
      discovered.set(pf.proxyUrl, { source: pf.source, confidence: 'possible' });
    }
  }

  // ── Layer 5: Process inspection ───────────────────────────────────────────
  const procFindings = scanProcesses ? await detectProxyProcesses() : [];
  for (const pf of procFindings) findings.push(pf);

  // ── Layer 6: WPAD / DNS auto-discovery ────────────────────────────────────
  const wpadFindings = checkWpad ? await detectWpad() : [];
  for (const wf of wpadFindings) findings.push(wf);

  // ── Emit findings for each discovered proxy URL ────────────────────────────
  const anyDetected = discovered.size > 0 ||
    headerFindings.some(f => f.status !== 'info') ||
    procFindings.some(f => f.status !== 'info');

  if (!anyDetected) {
    findings.push({
      status: 'info',
      layer: 'summary',
      source: 'none',
      message: 'No proxy configuration detected from any detection layer.',
      proxyUrl: null,
      suggestions: [
        'If you are behind a corporate proxy, set HTTPS_PROXY=http://proxy-host:port.',
        'Alternatively add proxy settings to your Percy config file.'
      ]
    });
  }

  for (const [proxyUrl, { source, confidence }] of discovered) {
    const finding = {
      layer: confidence === 'definite' ? 'configuration' : 'heuristic',
      source,
      confidence,
      proxyUrl,
      message: `Proxy ${proxyUrl} (${source})`
    };

    if (testProxy) {
      const validation = await validateProxy(proxyUrl, timeout);

      // Port-scan proxies are speculative — an open port is not a confirmed
      // proxy. Downgrade any fail/warn to info so the overall check isn't
      // affected. Only surface as pass/warn if it actually works.
      if (confidence === 'possible') {
        if (validation.status === 'pass') {
          finding.status = 'pass';
          finding.message += ` — works for Percy (consider setting HTTPS_PROXY=${proxyUrl})`;
        } else {
          finding.status = 'info';
          finding.message += ` — port is open but not usable as a Percy proxy`;
        }
      } else {
        finding.status = validation.status;
        finding.message += ` — ${validation.message}`;
        finding.suggestions = validation.suggestions;
      }
      finding.proxyValidation = validation;
    } else {
      finding.status = 'info';
    }

    findings.push(finding);
  }

  return findings;
}

// ─── Layer 2: System-level ────────────────────────────────────────────────────

function detectMacOSProxy() {
  try {
    const out = execSync('scutil --proxy', { timeout: 5000, encoding: 'utf8' });

    // HTTPS proxy takes priority, fall back to HTTP
    const httpsEnabled = /HTTPSEnable\s*:\s*1/i.test(out);
    const httpEnabled = /HTTPEnable\s*:\s*1/i.test(out);

    if (httpsEnabled) {
      const host = out.match(/HTTPSProxy\s*:\s*(\S+)/i)?.[1];
      const port = out.match(/HTTPSPort\s*:\s*(\d+)/i)?.[1] ?? '8080';
      if (host) return { url: `http://${host}:${port}`, source: 'macOS:scutil(HTTPS)' };
    }
    if (httpEnabled) {
      const host = out.match(/HTTPProxy\s*:\s*(\S+)/i)?.[1];
      const port = out.match(/HTTPPort\s*:\s*(\d+)/i)?.[1] ?? '8080';
      if (host) return { url: `http://${host}:${port}`, source: 'macOS:scutil(HTTP)' };
    }
  } catch { /* ignore */ }
  return null;
}

// ─── Layer 2 continued: Linux / Windows ──────────────────────────────────────

function detectLinuxProxy() {
  // Try GNOME gsettings
  try {
    const mode = execSync('gsettings get org.gnome.system.proxy mode 2>/dev/null', {
      timeout: 3000, encoding: 'utf8'
    }).trim().replace(/'/g, '');

    if (mode === 'manual') {
      const host = execSync('gsettings get org.gnome.system.proxy.https host 2>/dev/null', {
        timeout: 3000, encoding: 'utf8'
      }).trim().replace(/'/g, '');
      const port = execSync('gsettings get org.gnome.system.proxy.https port 2>/dev/null', {
        timeout: 3000, encoding: 'utf8'
      }).trim();
      if (host && host !== "''") {
        return { url: `http://${host}:${port}`, source: 'linux:gsettings' };
      }
    }
  } catch { /* ignore */ }

  // Try /etc/environment
  try {
    const env = fs.readFileSync('/etc/environment', 'utf8');
    const match = env.match(/(?:HTTPS?_PROXY|https?_proxy)\s*=\s*['"]?([^'"\s]+)/i);
    if (match) return { url: match[1], source: 'linux:/etc/environment' };
  } catch { /* ignore */ }

  // Try /etc/profile.d/ scripts
  try {
    const dir = '/etc/profile.d';
    if (fs.existsSync(dir)) {
      for (const file of fs.readdirSync(dir)) {
        try {
          const content = fs.readFileSync(`${dir}/${file}`, 'utf8');
          const m = content.match(/export\s+(?:HTTPS?_PROXY|https?_proxy)\s*=\s*['"]?([^'"\s'"]+)/i);
          if (m) return { url: m[1], source: `linux:${dir}/${file}` };
        } catch { /* ignore */ }
      }
    }
  } catch { /* ignore */ }

  return null;
}

function detectWindowsProxy() {
  try {
    const enableOut = execSync(
      'reg query "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings" /v ProxyEnable 2>nul',
      { timeout: 5000, encoding: 'utf8' }
    );
    if (!enableOut.includes('0x1')) return null;

    const serverOut = execSync(
      'reg query "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings" /v ProxyServer 2>nul',
      { timeout: 5000, encoding: 'utf8' }
    );
    const m = serverOut.match(/ProxyServer\s+REG_SZ\s+(\S+)/);
    if (!m) return null;
    let url = m[1].trim();
    if (!url.startsWith('http')) url = `http://${url}`;
    return { url, source: 'windows:registry' };
  } catch { return null; }
}

// ─── Layer 3: HTTP response-header fingerprinting ────────────────────────────

async function detectViaHeaders(timeout) {
  // Probe a few endpoints and check response headers for proxy indicators
  const PROBE_TARGETS = [
    'https://percy.io',
    'http://httpbin.org/headers' // plain HTTP — proxy headers are more visible
  ];

  const findings = [];

  for (const target of PROBE_TARGETS) {
    try {
      const result = await probeUrl(target, { timeout, rejectUnauthorized: false });
      if (!result.responseHeaders) continue;

      const found = {};
      for (const [key, value] of Object.entries(result.responseHeaders ?? {})) {
        const lk = key.toLowerCase();
        if (PROXY_HEADER_INDICATORS.some(h => lk === h || lk.startsWith(h))) {
          found[key] = value;
        }
      }

      if (Object.keys(found).length > 0) {
        // Extract proxy address from Via header if present
        let detectedProxyUrl = null;
        const viaVal = Object.entries(found).find(([k]) => k.toLowerCase() === 'via')?.[1];
        if (viaVal) {
          // Via: 1.1 proxy.corp.example.com:8080 (Squid/4.1)
          const m = viaVal.match(/\d+\.\d+\s+([^:,\s(]+)(?::(\d+))?/);
          if (m && m[1] && !m[1].match(/^\d+\.\d+\.\d+\.\d+$/)) {
            detectedProxyUrl = `http://${m[1].trim()}:${m[2] ?? '8080'}`;
          }
        }

        findings.push({
          status: 'warn',
          layer: 'header-fingerprint',
          source: target,
          message: `Proxy-indicating headers detected in response from ${target}`,
          headers: found,
          detectedProxyUrl,
          suggestions: [
            'Your HTTP traffic is being intercepted by a proxy or security appliance.',
            detectedProxyUrl
              ? `Possible proxy address from Via header: set HTTPS_PROXY=${detectedProxyUrl}`
              : 'Set HTTPS_PROXY to your corporate proxy address.',
            'Check with your network team for the correct proxy endpoint.'
          ]
        });
      }
    } catch { /* probe failed, skip */ }
  }

  if (findings.length === 0) {
    findings.push({
      status: 'info',
      layer: 'header-fingerprint',
      source: 'header-scan',
      message: 'No proxy-indicating headers detected in HTTP responses.',
      headers: {}
    });
  }

  return findings;
}

// ─── Layer 4: Common-port scan ────────────────────────────────────────────────

async function scanProxyPorts(timeout) {
  const findings = [];
  const hosts = ['127.0.0.1'];

  // Also try the default gateway — corp proxies often run there
  const gateway = getDefaultGateway();
  if (gateway) hosts.push(gateway);

  const openPorts = [];
  await Promise.all(
    hosts.flatMap(host =>
      PROXY_PORTS.map(port =>
        tcpProbe(host, port, Math.min(timeout, 2000)).then(open => {
          if (open) openPorts.push({ host, port });
        })
      )
    )
  );

  if (openPorts.length === 0) {
    findings.push({
      status: 'info',
      layer: 'port-scan',
      source: 'port-scan',
      message: `No common proxy ports open on localhost/gateway (checked: ${PROXY_PORTS.join(', ')}).`
    });
  } else {
    for (const { host, port } of openPorts) {
      findings.push({
        status: 'warn',
        layer: 'port-scan',
        source: `port-scan:${host}`,
        proxyUrl: `http://${host}:${port}`,
        message: `Port ${port} open on ${host} — possible proxy`,
        suggestions: [
          `Test: percy doctor --proxy-server http://${host}:${port}`
        ]
      });
    }
  }

  return findings;
}

function tcpProbe(host, port, timeout) {
  return new Promise(resolve => {
    const sock = new net.Socket();
    sock.setTimeout(timeout);
    sock.on('connect', () => { sock.destroy(); resolve(true); });
    sock.on('timeout', () => { sock.destroy(); resolve(false); });
    sock.on('error', () => { sock.destroy(); resolve(false); });
    sock.connect(port, host);
  });
}

function getDefaultGateway() {
  try {
    const platform = os.platform();
    if (platform === 'darwin') {
      return execSync("netstat -rn | awk '/^default/{print $2; exit}' 2>/dev/null", {
        timeout: 3000, encoding: 'utf8'
      }).trim() || null;
    }
    if (platform === 'linux') {
      return execSync("ip route show default 2>/dev/null | awk '{print $3; exit}'", {
        timeout: 3000, encoding: 'utf8'
      }).trim() || null;
    }
    if (platform === 'win32') {
      return execSync(
        'powershell -Command "(Get-NetRoute -DestinationPrefix \'0.0.0.0/0\').NextHop | Select-Object -First 1"',
        { timeout: 5000, encoding: 'utf8' }
      ).trim() || null;
    }
  } catch { /* ignore */ }
  return null;
}

// ─── Layer 5: Process inspection ─────────────────────────────────────────────

async function detectProxyProcesses() {
  const findings = [];
  let processList = '';

  try {
    const platform = os.platform();
    if (platform === 'win32') {
      const { stdout } = await exec('tasklist /fo csv /nh 2>nul', { timeout: 5000 });
      processList = stdout.toLowerCase();
    } else {
      const { stdout } = await exec('ps aux 2>/dev/null || ps -ef 2>/dev/null', { timeout: 5000 });
      processList = stdout.toLowerCase();
    }
  } catch { /* ignore */ }

  const matched = PROXY_PROCESS_PATTERNS.filter(p => processList.includes(p.toLowerCase()));

  if (matched.length > 0) {
    findings.push({
      status: 'warn',
      layer: 'process-inspection',
      source: 'process-scan',
      message: `Security agent(s) detected: ${matched.join(', ')} — may intercept HTTPS`,
      processes: matched,
      suggestions: [
        'Set HTTPS_PROXY to your proxy endpoint, or add its root CA to NODE_EXTRA_CA_CERTS.',
        'Zscaler: set HTTPS_PROXY to ZIA gateway.  Netskope: HTTPS_PROXY=http://localhost:8080.'
      ]
    });
  } else {
    findings.push({
      status: 'info',
      layer: 'process-inspection',
      source: 'process-scan',
      message: 'No known proxy/security agent processes detected.'
    });
  }

  return findings;
}

// ─── Layer 6: WPAD / DNS auto-discovery ──────────────────────────────────────

async function detectWpad() {
  const findings = [];

  const wpadHosts = ['wpad'];
  try {
    const hostname = os.hostname();
    const parts = hostname.split('.');
    if (parts.length > 1) wpadHosts.push(`wpad.${parts.slice(1).join('.')}`);
  } catch { /* ignore */ }

  for (const wpadHost of wpadHosts) {
    try {
      const addresses = await new Promise((resolve, reject) => {
        dns.resolve4(wpadHost, (err, addrs) => err ? reject(err) : resolve(addrs));
      });

      if (addresses.length > 0) {
        const wpadUrl = `http://${wpadHost}/wpad.dat`;
        findings.push({
          status: 'warn',
          layer: 'wpad-discovery',
          source: `dns:${wpadHost}`,
          wpadHost,
          wpadUrl,
          resolvedIPs: addresses,
          message: `WPAD host "${wpadHost}" resolves to ${addresses[0]} — auto-proxy may be active`,
          suggestions: [
            `Inspect the PAC file: curl "${wpadUrl}"`,
            'See the PAC Detection section above for details on the resolved proxy.',
            'If WPAD routes percy.io via a proxy, set HTTPS_PROXY accordingly.'
          ]
        });
      }
    } catch { /* NXDOMAIN — no WPAD on this host */ }
  }

  if (findings.length === 0) {
    findings.push({
      status: 'info',
      layer: 'wpad-discovery',
      source: 'wpad-dns',
      message: 'No WPAD host found via DNS auto-discovery.'
    });
  }

  return findings;
}

// ─── Proxy validation ─────────────────────────────────────────────────────────

async function validateProxy(proxyUrl, timeout) {
  const TEST_URLS = ['https://percy.io', 'https://www.browserstack.com'];
  const rejectUnauthorized = process.env.NODE_TLS_REJECT_UNAUTHORIZED !== '0';
  const results = await Promise.all(
    TEST_URLS.map(u => probeUrl(u, { proxyUrl, timeout, rejectUnauthorized }))
  );

  const allOk = results.every(r => r.ok);
  const anyOk = results.some(r => r.ok);

  if (allOk) {
    return {
      status: 'pass',
      message: 'proxy connectivity OK for percy.io and browserstack.com',
      suggestions: []
    };
  }

  if (anyOk) {
    const failed = TEST_URLS.filter((_, i) => !results[i].ok);
    return {
      status: 'warn',
      message: `proxy reachable but could not connect to: ${failed.join(', ')}`,
      suggestions: [
        'Whitelist the unreachable domains on your proxy server.',
        'Check if proxy authentication is required (HTTPS_PROXY=http://user:pass@host:port).'
      ]
    };
  }

  const errors = results.map((r, i) => `${new URL(TEST_URLS[i]).hostname}: ${r.errorCode ?? r.error}`).join(', ');
  return {
    status: 'fail',
    message: `proxy cannot reach Percy/BrowserStack — ${errors}`,
    suggestions: [
      'Verify the proxy is running and allows outbound HTTPS to percy.io.',
      'If credentials needed: HTTPS_PROXY=http://user:pass@host:port'
    ]
  };
}
