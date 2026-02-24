import { spawn } from 'child_process';
import http from 'http';
import net from 'net';
import os from 'os';
import fs from 'fs';
import path from 'path';
import { URL } from 'url';

// ─── Chrome binary locations (searched in order) ──────────────────────────────

function systemChromePaths() {
  const home = os.homedir();
  const platform = os.platform();

  if (platform === 'darwin') {
    return [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
      '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
      path.join(home, 'Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
    ];
  }
  if (platform === 'linux') {
    return [
      '/usr/bin/google-chrome',
      '/usr/bin/google-chrome-stable',
      '/usr/bin/chromium-browser',
      '/usr/bin/chromium',
      '/snap/bin/chromium'
    ];
  }
  if (platform === 'win32') {
    const pf = process.env.PROGRAMFILES || 'C:\\Program Files';
    const pf86 = process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)';
    return [
      path.join(pf, 'Google\\Chrome\\Application\\chrome.exe'),
      path.join(pf86, 'Google\\Chrome\\Application\\chrome.exe'),
      path.join(home, 'AppData\\Local\\Google\\Chrome\\Application\\chrome.exe')
    ];
  }
  return [];
}

/** Returns the path to a usable Chrome/Chromium binary, or null. */
async function findChrome() {
  // 1. User-supplied override
  if (process.env.PERCY_BROWSER_EXECUTABLE) {
    const p = process.env.PERCY_BROWSER_EXECUTABLE;
    if (fs.existsSync(p)) return p;
  }

  // 2. Percy's bundled Chromium (core package lives beside cli-doctor in the monorepo)
  const coreDir = path.resolve(
    path.dirname(new URL(import.meta.url).pathname),
    '../../../../core/.local-chromium'
  );
  if (fs.existsSync(coreDir)) {
    const platform = os.platform();
    const arch = process.arch;
    const bundledPaths = [
      // darwin arm64
      ...(platform === 'darwin' && arch === 'arm64'
        ? fs.readdirSync(coreDir).map(r =>
          path.join(coreDir, r, 'chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'))
        : []),
      // darwin x64
      ...(platform === 'darwin' && arch !== 'arm64'
        ? fs.readdirSync(coreDir).map(r =>
          path.join(coreDir, r, 'chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'))
        : []),
      // linux
      ...(platform === 'linux'
        ? fs.readdirSync(coreDir).map(r => path.join(coreDir, r, 'chrome-linux', 'chrome'))
        : []),
      // windows
      ...(platform === 'win32'
        ? fs.readdirSync(coreDir).map(r => path.join(coreDir, r, 'chrome-win', 'chrome.exe'))
        : [])
    ];
    for (const p of bundledPaths) {
      if (fs.existsSync(p)) return p;
    }
  }

  // 3. System Chrome
  for (const p of systemChromePaths()) {
    if (fs.existsSync(p)) return p;
  }

  return null;
}

// ─── CDP helpers ──────────────────────────────────────────────────────────────

/** Find a free TCP port by letting the OS assign one. */
function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

/**
 * Poll Chrome's /json/list endpoint for a page-type target's WS URL.
 * Network.enable and Page.enable are page-level CDP domains — they must be sent
 * to a page target, not the browser-level target from /json/version.
 */
function pollCDPPageTarget(port) {
  return new Promise((resolve, reject) => {
    const req = http.get(`http://127.0.0.1:${port}/json/list`, { timeout: 1000 }, (res) => {
      let body = '';
      res.on('data', d => (body += d));
      res.on('end', () => {
        try {
          const targets = JSON.parse(body);
          const page = targets.find(t => t.type === 'page' && t.webSocketDebuggerUrl);
          if (page) resolve(page.webSocketDebuggerUrl);
          else reject(new Error('no page target ready'));
        } catch {
          reject(new Error('invalid CDP response'));
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => reject(new Error('CDP poll timeout')));
  });
}

/** Wait until Chrome's CDP page target is ready and return its webSocketDebuggerUrl. */
async function waitForCDP(port, timeout = 15000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      const wsUrl = await pollCDPPageTarget(port);
      if (wsUrl) return wsUrl;
    } catch { /* not ready yet */ }
    await new Promise(r => setTimeout(r, 250));
  }
  throw new Error('Timed out waiting for Chrome CDP page target');
}

/**
 * Minimal CDP client over WebSocket.
 * Only depends on the `ws` package (transitive dep via @percy/core).
 */
async function connectCDP(wsUrl) {
  const { default: WS } = await import('ws');
  const ws = new WS(wsUrl, { perMessageDeflate: false });

  await new Promise((resolve, reject) => {
    ws.once('open', resolve);
    ws.once('error', reject);
  });

  let _id = 0;
  const _pending = new Map();
  const _listeners = new Map(); // event → Set<handler>

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }

    if (msg.id && _pending.has(msg.id)) {
      const { resolve, reject } = _pending.get(msg.id);
      _pending.delete(msg.id);
      msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result ?? {});
    }

    if (msg.method) {
      for (const handler of (_listeners.get(msg.method) ?? [])) {
        handler(msg.params);
      }
    }
  });

  return {
    send(method, params = {}) {
      const id = ++_id;
      return new Promise((resolve, reject) => {
        _pending.set(id, { resolve, reject });
        ws.send(JSON.stringify({ id, method, params }));
      });
    },
    on(event, handler) {
      if (!_listeners.has(event)) _listeners.set(event, new Set());
      _listeners.get(event).add(handler);
    },
    close() { ws.close(); }
  };
}

// ─── Core capture logic ───────────────────────────────────────────────────────

/**
 * Launch Chrome and capture all network activity for a given URL.
 *
 * @param {string}  chromePath
 * @param {string}  targetUrl
 * @param {object}  [opts]
 * @param {boolean} [opts.headless=true]
 * @param {number}  [opts.timeout=30000]     Navigation timeout ms
 * @param {string}  [opts.proxyUrl]          Optional --proxy-server
 * @returns {Promise<NetworkCapture>}
 */
async function captureNetworkRequests(chromePath, targetUrl, opts = {}) {
  const { headless = true, timeout = 30000, proxyUrl } = opts;

  const port = await getFreePort();
  const chromeArgs = [
    `--remote-debugging-port=${port}`,
    '--no-sandbox',
    '--disable-extensions',
    '--disable-background-networking',
    '--disable-default-apps',
    '--disable-sync',
    '--disable-translate',
    '--metrics-recording-only',
    '--no-first-run',
    '--safebrowsing-disable-auto-update',
    '--password-store=basic',
    '--use-mock-keychain',
    headless ? '--headless=new' : '',
    headless ? '--hide-scrollbars' : '',
    headless ? '--mute-audio' : '',
    proxyUrl ? `--proxy-server=${proxyUrl}` : '',
    'about:blank'
  ].filter(Boolean);

  const proc = spawn(chromePath, chromeArgs, {
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false
  });

  const requests = new Map(); // requestId → RequestInfo
  const responses = new Map(); // requestId → ResponseInfo
  const failed = new Map(); // requestId → FailInfo
  const proxyHeaders = new Set(); // proxy-indicating header names seen

  let captureError = null;

  try {
    const wsUrl = await waitForCDP(port, 12000);
    const cdp = await connectCDP(wsUrl);

    // ── Track requests ──────────────────────────────────────────────────────
    cdp.on('Network.requestWillBeSent', (p) => {
      if (p.request.url.startsWith('data:')) return;
      requests.set(p.requestId, {
        url: p.request.url,
        hostname: safeHostname(p.request.url),
        method: p.request.method,
        type: p.type,
        initiatorType: p.initiator?.type,
        timestamp: p.timestamp
      });
    });

    cdp.on('Network.responseReceived', (p) => {
      const res = p.response;
      responses.set(p.requestId, {
        status: res.status,
        statusText: res.statusText,
        fromCache: res.fromDiskCache || res.fromServiceWorker,
        protocol: res.protocol,
        remoteIPAddress: res.remoteIPAddress,
        headers: res.headers
      });

      // Detect proxy-indicative headers
      for (const h of Object.keys(res.headers ?? {})) {
        const lh = h.toLowerCase();
        if (lh.startsWith('x-proxy') || lh.startsWith('proxy-') ||
            lh === 'via' || lh === 'x-forwarded-for' ||
            lh === 'x-forwarded-host' || lh.includes('zscaler') ||
            lh.includes('netskope') || lh.includes('bluecoat') ||
            lh === 'x-cache' || lh === 'cf-ray') {
          proxyHeaders.add(`${h}: ${res.headers[h]}`);
        }
      }
    });

    cdp.on('Network.loadingFailed', (p) => {
      failed.set(p.requestId, {
        errorText: p.errorText,
        blockedReason: p.blockedReason,
        corsErrorStatus: p.corsErrorStatus
      });
    });

    // ── Enable domains + navigate ───────────────────────────────────────────
    await Promise.all([
      cdp.send('Network.enable'),
      cdp.send('Page.enable')
    ]);

    const navStart = Date.now();

    await cdp.send('Page.navigate', { url: targetUrl });
    await Promise.race([
      new Promise(resolve => cdp.on('Page.loadEventFired', () => setTimeout(resolve, 2500))),
      new Promise(resolve => setTimeout(resolve, timeout))
    ]);

    const navMs = Date.now() - navStart;

    cdp.close();

    // ── Build result ────────────────────────────────────────────────────────
    const allRequests = [];
    for (const [id, req] of requests) {
      const res = responses.get(id) ?? null;
      const fail = failed.get(id) ?? null;
      allRequests.push({
        ...req,
        response: res,
        failure: fail,
        reachable: res ? (res.status >= 200 && res.status < 400) : false,
        blocked: !!fail?.blockedReason,
        errorText: fail?.errorText ?? null
      });
    }

    return {
      targetUrl,
      proxyUrl: proxyUrl ?? null,
      navMs,
      requests: allRequests,
      proxyHeaders: Array.from(proxyHeaders),
      error: null
    };
  } catch (err) {
    captureError = err.message;
    // Return whatever was accumulated by the event listeners before the error
    // so domainSummary is still populated in the JSON report and terminal table.
    const partialRequests = [];
    for (const [id, req] of requests) {
      const res = responses.get(id) ?? null;
      const fail = failed.get(id) ?? null;
      partialRequests.push({
        ...req,
        response: res,
        failure: fail,
        reachable: res ? (res.status >= 200 && res.status < 400) : false,
        blocked: !!fail?.blockedReason,
        errorText: fail?.errorText ?? null
      });
    }
    return {
      targetUrl,
      proxyUrl: proxyUrl ?? null,
      navMs: 0,
      requests: partialRequests,
      proxyHeaders: Array.from(proxyHeaders),
      error: captureError
    };
  } finally {
    try { proc.kill('SIGTERM'); } catch { /* ignore */ }
    await new Promise(resolve => proc.once('exit', resolve));
  }
}

function safeHostname(rawUrl) {
  try { return new URL(rawUrl).hostname; } catch { return rawUrl; }
}

// ─── Analyse & build findings ─────────────────────────────────────────────────

function analyseCapture(capture) {
  const byHostname = new Map();

  for (const req of capture.requests) {
    const h = req.hostname;
    if (!byHostname.has(h)) {
      byHostname.set(h, { hostname: h, requests: [], reachable: false, blocked: false, errors: new Set() });
    }
    const entry = byHostname.get(h);
    entry.requests.push(req);

    if (req.reachable) entry.reachable = true;
    if (req.blocked) entry.blocked = true;
    if (req.errorText && req.errorText !== 'net::ERR_ABORTED') {
      entry.errors.add(req.errorText);
    }
  }

  // Flatten errors set to array
  for (const entry of byHostname.values()) {
    entry.errors = Array.from(entry.errors);
  }

  return byHostname;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Check 5 – Browser Network Analysis
 *
 * Launches Chrome (bundled Chromium or system) and navigates to `targetUrl`.
 * All network requests are captured and grouped by hostname into:
 *   reachable / blocked / errored
 *
 * If `proxyUrl` is provided the test is run twice (direct + via proxy) so the
 * delta is visible.
 *
 * @param {object}  [options]
 * @param {string}  [options.targetUrl]    URL to open (default: https://percy.io)
 * @param {string}  [options.proxyUrl]     Optional proxy server to test
 * @param {number}  [options.timeout]      Navigation timeout ms (default: 30000)
 * @param {boolean} [options.headless]     Run headless (default: true)
 * @returns {Promise<BrowserFinding>}
 */
export async function checkBrowserNetwork(options = {}) {
  const {
    targetUrl = 'https://percy.io',
    proxyUrl,
    timeout = 30000,
    headless = true
  } = options;

  // ── 1. Find Chrome ─────────────────────────────────────────────────────────
  const chromePath = await findChrome();

  if (!chromePath) {
    return {
      status: 'skip',
      message: 'Chrome / Chromium not found. Install Google Chrome or set PERCY_BROWSER_EXECUTABLE.',
      chromePath: null,
      targetUrl,
      directCapture: null,
      proxyCapture: null,
      domainSummary: [],
      proxyHeaders: [],
      suggestions: [
        'Install Google Chrome from https://www.google.com/chrome/',
        'Or set PERCY_BROWSER_EXECUTABLE=/path/to/chrome in your environment.'
      ]
    };
  }

  // ── 2. Direct capture ──────────────────────────────────────────────────────
  const directCapture = await captureNetworkRequests(chromePath, targetUrl, {
    headless, timeout
  });

  // ── 3. Proxy capture (if requested) ────────────────────────────────────────
  const proxyCapture = proxyUrl
    ? await captureNetworkRequests(chromePath, targetUrl, { headless, timeout, proxyUrl })
    : null;

  // ── 4. Build domain-level summary ─────────────────────────────────────────
  const directByHost = analyseCapture(directCapture);
  const proxyByHost = proxyCapture ? analyseCapture(proxyCapture) : null;

  const allHostnames = new Set([
    ...directByHost.keys(),
    ...(proxyByHost?.keys() ?? [])
  ]);

  const domainSummary = [];
  for (const hostname of allHostnames) {
    const direct = directByHost.get(hostname) ?? null;
    const viaProxy = proxyByHost?.get(hostname) ?? null;

    let status;
    if (direct?.reachable) {
      status = 'pass';
    } else if (viaProxy?.reachable) {
      status = 'warn'; // reachable via proxy only
    } else {
      status = direct ? 'fail' : 'skip';
    }

    const entry = {
      hostname,
      status,
      direct: direct
        ? {
            reachable: direct.reachable,
            blocked: direct.blocked,
            errors: direct.errors,
            sampleStatus: direct.requests.find(r => r.response)?.response?.status ?? null
          }
        : null,
      viaProxy: viaProxy
        ? {
            reachable: viaProxy.reachable,
            blocked: viaProxy.blocked,
            errors: viaProxy.errors,
            sampleStatus: viaProxy.requests.find(r => r.response)?.response?.status ?? null
          }
        : null
    };
    domainSummary.push(entry);
  }

  // Sort: failures first
  const order = { fail: 0, warn: 1, pass: 2, skip: 3 };
  domainSummary.sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9));

  // ── 5. Aggregate proxy headers ─────────────────────────────────────────────
  const proxyHeaders = [
    ...new Set([
      ...directCapture.proxyHeaders,
      ...(proxyCapture?.proxyHeaders ?? [])
    ])
  ];

  // ── 6. Overall status ──────────────────────────────────────────────────────
  const hasFail = domainSummary.some(d => d.status === 'fail');
  const hasWarn = domainSummary.some(d => d.status === 'warn');
  const overallStatus = hasFail ? 'fail' : (hasWarn ? 'warn' : 'pass');

  return {
    status: overallStatus,
    chromePath,
    targetUrl,
    directCapture,
    proxyCapture,
    domainSummary,
    proxyHeaders,
    navMs: directCapture.navMs,
    error: directCapture.error
  };
}
