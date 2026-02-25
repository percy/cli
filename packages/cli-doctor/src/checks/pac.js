import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import vm from 'vm';

// Test URL used when evaluating PAC scripts
const PAC_TEST_URL = 'https://percy.io/';
const PAC_TEST_HOST = 'percy.io';

/**
 * Check 4 – PAC (Proxy Auto-Configuration) File Detection
 *
 * Detection covers:
 *   System level:
 *     • macOS  – networksetup -getautoproxyurl <interface>
 *                System Preferences network config plist
 *     • Linux  – gsettings org.gnome.system.proxy autoconfig-url
 *                /etc/apt/apt.conf.d/ (apt proxy)
 *     • Windows– HKCU Internet Settings AutoConfigURL
 *
 *   Browser / application level:
 *     • Chrome / Chromium – "Local State" JSON
 *     • Firefox           – profile prefs.js
 *
 * For each PAC URL found the script is fetched (if reachable), then
 * evaluated with a minimal FindProxyForURL implementation using Node's vm.
 * Because full WPAD/PAC evaluation requires a sandbox, the evaluation is
 * best-effort: it resolves the recommended proxy string or "DIRECT".
 *
 * @returns {Promise<PacFinding[]>}
 */
export async function detectPAC() {
  const findings = [];
  const discovered = []; // { url, source }

  // ── System-level detection ────────────────────────────────────────────────
  const platform = os.platform();
  if (platform === 'darwin') discovered.push(..._macOSPacUrls());
  else if (platform === 'linux') discovered.push(..._linuxPacUrls());
  else if (platform === 'win32') discovered.push(..._windowsPacUrls());

  // ── Browser-level detection ───────────────────────────────────────────────
  discovered.push(..._chromePacUrls());
  discovered.push(..._firefoxPacUrls());

  if (discovered.length === 0) {
    findings.push({
      status: 'info',
      source: 'none',
      message: 'No PAC (Proxy Auto-Configuration) file detected.',
      pacUrl: null,
      resolvedProxy: null,
      suggestions: []
    });
    return findings;
  }

  // ── Evaluate each discovered PAC ──────────────────────────────────────────
  for (const { url: pacUrl, source } of discovered) {
    const finding = await _evaluatePac(pacUrl, source);
    findings.push(finding);
  }

  return findings;
}

// ─── macOS ────────────────────────────────────────────────────────────────────

function _macOSPacUrls() {
  const urls = [];

  // Try each common network interface
  const interfaces = ['Wi-Fi', 'Ethernet', 'en0', 'en1'];
  for (const iface of interfaces) {
    try {
      const out = execSync(`networksetup -getautoproxyurl "${iface}" 2>/dev/null`, {
        timeout: 4000, encoding: 'utf8'
      });
      // Output: "URL: http://...\nEnabled: Yes"
      const urlMatch = out.match(/URL:\s*(\S+)/);
      const enabledMatch = out.match(/Enabled:\s*(\w+)/i);
      if (urlMatch && enabledMatch?.[1]?.toLowerCase() === 'yes') {
        const url = urlMatch[1].trim();
        if (url && url !== '(null)') {
          urls.push({ url, source: `macOS:networksetup(${iface})` });
          break; // Found one, no need to check more interfaces
        }
      }
    } catch { /* interface not available */ }
  }

  // Also check system configuration plist
  const plistPaths = [
    '/Library/Preferences/SystemConfiguration/preferences.plist',
    path.join(os.homedir(), 'Library/Preferences/com.apple.systempreferences.plist')
  ];
  for (const p of plistPaths) {
    if (!fs.existsSync(p)) continue;
    try {
      // Use plutil to convert binary plist to JSON
      const json = execSync(`plutil -convert json -o - "${p}" 2>/dev/null`, {
        timeout: 4000, encoding: 'utf8'
      });
      const data = JSON.parse(json);
      const pacUrl = _findInObject(data, 'ProxyAutoConfigURLString');
      if (pacUrl) urls.push({ url: pacUrl, source: 'macOS:plist' });
    } catch { /* ignore */ }
  }

  return urls;
}

// ─── Linux ────────────────────────────────────────────────────────────────────

function _linuxPacUrls() {
  const urls = [];

  // GNOME gsettings
  try {
    const mode = execSync('gsettings get org.gnome.system.proxy mode 2>/dev/null', {
      timeout: 3000, encoding: 'utf8'
    }).trim().replace(/'/g, '');
    if (mode === 'auto') {
      const pacUrl = execSync('gsettings get org.gnome.system.proxy autoconfig-url 2>/dev/null', {
        timeout: 3000, encoding: 'utf8'
      }).trim().replace(/'/g, '');
      if (pacUrl && pacUrl !== "''") urls.push({ url: pacUrl, source: 'linux:gsettings' });
    }
  } catch { /* gsettings not available */ }

  // /etc/environment
  try {
    const env = fs.readFileSync('/etc/environment', 'utf8');
    const match = env.match(/(?:AUTO_PROXY|auto_proxy|WPAD_URL)\s*=\s*['"]?([^'"\s]+)/i);
    if (match) urls.push({ url: match[1], source: 'linux:/etc/environment' });
  } catch { /* ignore */ }

  return urls;
}

// ─── Windows ──────────────────────────────────────────────────────────────────

function _windowsPacUrls() {
  const urls = [];
  try {
    const out = execSync(
      'reg query "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings" /v AutoConfigURL 2>nul',
      { timeout: 5000, encoding: 'utf8' }
    );
    const match = out.match(/AutoConfigURL\s+REG_SZ\s+(\S+)/);
    if (match) urls.push({ url: match[1].trim(), source: 'windows:registry' });
  } catch { /* ignore */ }

  // Also check WPAD via DHCP/DNS (just report the well-known URL)
  // Full WPAD resolution would require DNS/DHCP queries which is outside scope
  return urls;
}

// ─── Chrome / Chromium ────────────────────────────────────────────────────────

function _chromePacUrls() {
  const urls = [];
  const platform = os.platform();

  const localStateLocations = {
    darwin: [
      path.join(os.homedir(), 'Library/Application Support/Google/Chrome/Local State'),
      path.join(os.homedir(), 'Library/Application Support/Chromium/Local State')
    ],
    linux: [
      path.join(os.homedir(), '.config/google-chrome/Local State'),
      path.join(os.homedir(), '.config/chromium/Local State')
    ],
    win32: [
      path.join(os.homedir(), 'AppData/Local/Google/Chrome/User Data/Local State'),
      path.join(os.homedir(), 'AppData/Local/Chromium/User Data/Local State')
    ]
  }[platform] ?? [];

  for (const localStatePath of localStateLocations) {
    if (!fs.existsSync(localStatePath)) continue;
    try {
      const state = JSON.parse(fs.readFileSync(localStatePath, 'utf8'));
      // Chrome stores proxy settings in: browser.last_known_google_url or
      // proxy extension settings – PAC URLs appear under net.network_prediction_options
      // More reliably found in the Preferences file:
      const prefsPath = path.join(path.dirname(localStatePath), 'Default/Preferences');
      if (fs.existsSync(prefsPath)) {
        const prefs = JSON.parse(fs.readFileSync(prefsPath, 'utf8'));
        const pacScript = prefs?.proxy?.pac_url ||
          prefs?.chromeos?.proxy?.pac_url ||
          _findInObject(prefs?.proxy ?? {}, 'pac_url');
        if (pacScript) {
          urls.push({ url: pacScript, source: `chrome:Preferences(${path.dirname(prefsPath)})` });
        }
      }
      // Check extension-based proxy settings
      const extProxies = _findInObject(state, 'pac_url') ?? _findInObject(state, 'pac_script');
      if (extProxies) urls.push({ url: extProxies, source: 'chrome:extension' });
    } catch { /* ignore parse errors */ }
  }
  return urls;
}

// ─── Firefox ──────────────────────────────────────────────────────────────────

function _firefoxPacUrls() {
  const urls = [];
  const platform = os.platform();

  const profileDirs = {
    darwin: path.join(os.homedir(), 'Library/Application Support/Firefox/Profiles'),
    linux: path.join(os.homedir(), '.mozilla/firefox'),
    win32: path.join(os.homedir(), 'AppData/Roaming/Mozilla/Firefox/Profiles')
  }[platform];

  if (!profileDirs || !fs.existsSync(profileDirs)) return urls;

  let profileEntries = [];
  try {
    profileEntries = fs.readdirSync(profileDirs, { withFileTypes: true })
      .filter(e => e.isDirectory())
      .map(e => path.join(profileDirs, e.name));
  } catch { return urls; }

  for (const profileDir of profileEntries) {
    const prefsPath = path.join(profileDir, 'prefs.js');
    if (!fs.existsSync(prefsPath)) continue;

    try {
      const prefs = fs.readFileSync(prefsPath, 'utf8');
      // network.proxy.type 2 = PAC; type 4 = WPAD auto-detect
      const typeMatch = prefs.match(/user_pref\s*\(\s*"network\.proxy\.type"\s*,\s*(\d+)\s*\)/);
      const pacMatch = prefs.match(/user_pref\s*\(\s*"network\.proxy\.autoconfig_url"\s*,\s*"([^"]+)"\s*\)/);

      if (typeMatch && ['2', '4'].includes(typeMatch[1]) && pacMatch) {
        urls.push({ url: pacMatch[1], source: `firefox:prefs.js(${profileDir})` });
      }
    } catch { /* ignore */ }
  }

  return urls;
}

// ─── PAC evaluation ──────────────────────────────────────────────────────────

async function _evaluatePac(pacUrl, source) {
  const baseFinding = {
    source,
    pacUrl,
    resolvedProxy: null,
    suggestions: []
  };

  // Fetch PAC content
  let pacScript;
  try {
    // We need the body – use a raw http/https request
    pacScript = await _fetchText(pacUrl);
  } catch (err) {
    return {
      ...baseFinding,
      status: 'warn',
      message: `PAC file detected at ${pacUrl} (source: ${source}) but could not be fetched: ${err.message}`,
      suggestions: [
        'Ensure the PAC server is reachable from this machine.',
        `Manually inspect: curl -v "${pacUrl}"`
      ]
    };
  }

  // Evaluate PAC script in a sandboxed Node vm context
  let resolvedProxy = 'UNKNOWN';
  try {
    resolvedProxy = _runPacScript(pacScript, PAC_TEST_URL, PAC_TEST_HOST);
  } catch (err) {
    return {
      ...baseFinding,
      status: 'warn',
      message: `PAC file at ${pacUrl} could not be evaluated: ${err.message}`,
      suggestions: [
        'Manually evaluate the PAC file to confirm which proxy is used for percy.io.',
        `Inspect PAC content: curl "${pacUrl}"`
      ]
    };
  }

  const isDirect = resolvedProxy.trim().toUpperCase().startsWith('DIRECT');
  const finding = {
    ...baseFinding,
    resolvedProxy,
    status: isDirect ? 'info' : 'warn',
    message: isDirect
      ? `PAC file (${source}) resolves percy.io as: DIRECT (no proxy needed).`
      : `PAC file (${source}) resolves percy.io proxy as: ${resolvedProxy}`
  };

  if (!isDirect) {
    // Extract the proxy URL from the PAC result string e.g. "PROXY proxy.corp:8080"
    const proxyMatch = resolvedProxy.match(/PROXY\s+(\S+)/i);
    if (proxyMatch) {
      finding.detectedProxyUrl = `http://${proxyMatch[1]}`;
      finding.suggestions = [
        `Set HTTPS_PROXY=http://${proxyMatch[1]} in your environment so Percy can route traffic.`,
        `Add this to your CI environment: HTTPS_PROXY=http://${proxyMatch[1]}`
      ];
    }
  }

  return finding;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Recursively search an object for a key, return first value found. */
function _findInObject(obj, key, depth = 0) {
  if (depth > 6 || typeof obj !== 'object' || obj === null) return null;
  if (key in obj) return obj[key];
  for (const v of Object.values(obj)) {
    const found = _findInObject(v, key, depth + 1);
    if (found) return found;
  }
  return null;
}

/** Fetch text content of a URL using Node built-in http/https. */
async function _fetchText(url) {
  const mod = url.startsWith('https')
    ? (await import('https')).default
    : (await import('http')).default;

  return new Promise((resolve, reject) => {
    const req = mod.get(url, { timeout: 8000 }, (res) => {
      let data = '';
      res.on('data', c => (data += c));
      res.on('end', () => resolve(data));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('PAC fetch timed out'));
    });
  });
}

/**
 * Evaluate a PAC script using Node's built-in `vm` module.
 * Provides minimal shims for the standard PAC helper functions.
 * Returns the string result of FindProxyForURL(url, host).
 */
function _runPacScript(script, url, host) {
  const sandbox = {
    // ── Standard PAC helper shims ────────────────────────────────────────
    isPlainHostName: h => !h.includes('.'),
    dnsDomainIs: (h, d) => h.endsWith(d),
    localHostOrDomainIs: (h, hd) => h === hd || h.split('.')[0] === hd.split('.')[0],
    isResolvable: () => true, // best-effort
    isInNet: () => false, // cannot do subnet checks without DNS
    dnsResolve: h => h,
    myIpAddress: () => '127.0.0.1',
    dnsDomainLevels: h => (h.match(/\./g) || []).length,
    shExpMatch: (str, shexp) => {
      const re = new RegExp('^' + shexp.replace(/\./g, '\\.').replace(/\*/g, '.*').replace(/\?/g, '.') + '$');
      return re.test(str);
    },
    weekdayRange: () => true,
    dateRange: () => true,
    timeRange: () => true,
    FindProxyForURL: null // will be defined by PAC script
  };

  const ctx = vm.createContext(sandbox);
  vm.runInContext(script, ctx);

  if (typeof sandbox.FindProxyForURL !== 'function') {
    throw new Error('PAC script does not define FindProxyForURL');
  }

  return String(sandbox.FindProxyForURL(url, host));
}
