import { spawn } from 'child_process';
import http from 'http';
import net from 'net';
import os from 'os';
import fs from 'fs';
import path from 'path';
import { URL } from 'url';

// ─── Path-safety helpers ────────────────────────────────────────────────────

/**
 * Validate and normalize an executable path that may come from user/env input.
 * Returns the resolved absolute path, or null when the value looks unsafe.
 * We intentionally avoid shell: true in spawn() but still sanitize here so
 * that Semgrep can statically confirm chromePath is clean before it reaches
 * the child-process call.
 */
export function sanitizeExecutablePath(p) {
  if (!p || typeof p !== 'string') return null;
  // Reject anything containing shell metacharacters before resolving
  if (/[;&|`$<>\n\r"']/.test(p)) return null;
  // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
  const resolved = path.resolve(p);
  if (!path.isAbsolute(resolved)) return null;
  return resolved;
}

/**
 * Validate an environment-variable directory path before using it in
 * path.join(). Returns `val` (resolved) when it is an absolute path;
 * falls back to `fallback` otherwise, preventing path-traversal via a
 * tampered PROGRAMFILES env var.
 */
export function safeEnvPath(val, fallback) {
  if (!val || typeof val !== 'string') return fallback;
  // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
  const resolved = path.resolve(val);
  return path.isAbsolute(resolved) ? resolved : fallback;
}

// ─── Request lifecycle & network capture (mirrors @percy/core's network.js) ───

/**
 * Tracks the two key lifecycle moments for a single CDP requestId so that
 * async event handlers can await proper ordering — the same pattern used in
 * @percy/core's RequestLifeCycleHandler.
 */
class RequestLifecycle {
  constructor() {
    this.requestWillBeSent = new Promise(r => (this.resolveRequestWillBeSent = r));
    this.responseReceived = new Promise(r => (this.resolveResponseReceived = r));
  }
}

/**
 * Lightweight network-event aggregator modelled on @percy/core's Network class.
 *
 * Uses per-request Promise chains to guarantee event processing order:
 *   requestWillBeSent → responseReceived → loadingFailed
 *
 * This prevents response/failure data being stored before the corresponding
 * request record exists, which can occur when Chrome emits events out of order.
 */
export class NetworkCapture {
  #lifecycles = new Map();
  #requests = new Map();
  #responses = new Map();
  #failed = new Map();
  #proxyHeaders = new Set();

  #lifecycle(requestId) {
    if (!this.#lifecycles.has(requestId)) {
      this.#lifecycles.set(requestId, new RequestLifecycle());
    }
    return this.#lifecycles.get(requestId);
  }

  /** Network.requestWillBeSent — stores request info and releases lifecycle. */
  onRequestWillBeSent({ requestId, request, type, timestamp }) {
    if (request.url.startsWith('data:')) return;
    this.#requests.set(requestId, {
      url: request.url,
      hostname: safeHostname(request.url),
      method: request.method,
      type,
      initiatorType: request.initiator?.type,
      timestamp
    });
    this.#lifecycle(requestId).resolveRequestWillBeSent();
  }

  /** Network.responseReceived — awaits requestWillBeSent before storing response. */
  async onResponseReceived({ requestId, response }) {
    await this.#lifecycle(requestId).requestWillBeSent;
    this.#responses.set(requestId, {
      status: response.status,
      statusText: response.statusText,
      fromCache: response.fromDiskCache || response.fromServiceWorker,
      protocol: response.protocol,
      remoteIPAddress: response.remoteIPAddress,
      headers: response.headers
    });
    // Collect proxy-indicating headers
    for (const h of Object.keys(response.headers ?? {})) {
      const lh = h.toLowerCase();
      if (
        lh.startsWith('x-proxy') || lh.startsWith('proxy-') ||
        lh === 'via' || lh === 'x-forwarded-for' || lh === 'x-forwarded-host' ||
        lh.includes('zscaler') || lh.includes('netskope') || lh.includes('bluecoat') ||
        lh === 'x-cache' || lh === 'cf-ray'
      ) {
        this.#proxyHeaders.add(`${h}: ${response.headers[h]}`);
      }
    }
    this.#lifecycle(requestId).resolveResponseReceived();
  }

  /** Network.loadingFailed — awaits requestWillBeSent before storing failure. */
  async onLoadingFailed({ requestId, errorText, blockedReason, corsErrorStatus }) {
    await this.#lifecycle(requestId).requestWillBeSent;
    this.#failed.set(requestId, { errorText, blockedReason, corsErrorStatus });
  }

  /** Merge all tracked maps into a flat request array. */
  buildRequests() {
    const result = [];
    for (const [id, req] of this.#requests) {
      const res = this.#responses.get(id) ?? null;
      const fail = this.#failed.get(id) ?? null;
      result.push({
        ...req,
        response: res,
        failure: fail,
        reachable: res ? (res.status >= 200 && res.status < 400) : false,
        blocked: !!fail?.blockedReason,
        errorText: fail?.errorText ?? null
      });
    }
    return result;
  }

  getProxyHeaders() { return Array.from(this.#proxyHeaders); }
}

export function safeHostname(rawUrl) {
  try { return new URL(rawUrl).hostname; } catch { return rawUrl; }
}

export function sanitizeProxyForChrome(proxyUrl) {
  if (!proxyUrl) return null;
  try {
    const p = new URL(proxyUrl);
    p.username = '';
    p.password = '';
    return p.toString().replace(/\/$/, '');
  } catch {
    /* istanbul ignore next */
    return proxyUrl;
  }
}

// ─── Analyse & build findings ─────────────────────────────────────────────────

export function analyseCapture(capture) {
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

// ─── BrowserChecker ───────────────────────────────────────────────────────────

/**
 * All Chrome browser-network analysis logic lives here as methods.
 * Instantiate and call checkBrowserNetwork() to run Check 5.
 */
export class BrowserChecker {
  // ─── Private: Chrome binary discovery ──────────────────────────────────────

  /** Return platform-specific candidate Chrome binary paths in priority order. */
  #systemChromePaths() {
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
      const pf = safeEnvPath(process.env.PROGRAMFILES, 'C:\\Program Files');
      const pf86 = safeEnvPath(process.env['PROGRAMFILES(X86)'], 'C:\\Program Files (x86)');
      return [
        path.join(pf, 'Google\\Chrome\\Application\\chrome.exe'),
        path.join(pf86, 'Google\\Chrome\\Application\\chrome.exe'),
        path.join(home, 'AppData\\Local\\Google\\Chrome\\Application\\chrome.exe')
      ];
    }
    return [];
  }

  /**
   * Locate a usable Chrome/Chromium binary.
   *
   * Search order:
   *  1. PERCY_BROWSER_EXECUTABLE (user override)
   *  2. Percy's bundled Chromium via @percy/core/src/install.js
   *  3. System-installed Chrome/Chromium (fallback when install fails)
   *
   * @returns {Promise<string|null>}
   */
  async #findChrome() {
    // 1. User-supplied override — sanitize before use (resolves path-traversal
    //    and detect-child-process Semgrep findings: chromePath is always a
    //    resolved absolute path with no shell metacharacters by the time it
    //    reaches spawn()).
    if (process.env.PERCY_BROWSER_EXECUTABLE) {
      const p = sanitizeExecutablePath(process.env.PERCY_BROWSER_EXECUTABLE);
      /* istanbul ignore next */
      if (p && fs.existsSync(p)) return p;
    }

    // 2. Percy's bundled Chromium (managed by @percy/core, lazy import)
    try {
      const { chromium: installChromium } = await import('@percy/core/src/install.js');
      /* istanbul ignore next */
      return await installChromium();
    } catch { /* fall through to system Chrome */ }

    // 3. System Chrome
    for (const p of this.#systemChromePaths()) {
      /* istanbul ignore next */
      if (fs.existsSync(p)) return p;
    }
    return null;
  }

  // ─── Private: CDP helpers ───────────────────────────────────────────────────

  /** Find a free TCP port by letting the OS assign one. */
  #getFreePort() {
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
  _pollCDPPageTarget(port) {
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
  /* istanbul ignore next */
  async _waitForCDP(port, timeout = 30000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      try {
        const wsUrl = await this._pollCDPPageTarget(port);
        if (wsUrl) return wsUrl;
      } catch { /* not ready yet */ }
      await new Promise(r => setTimeout(r, 150));
    }
    throw new Error('Timed out waiting for Chrome CDP page target');
  }

  /**
   * Minimal CDP client over WebSocket.
   * Only depends on the `ws` package (transitive dep via @percy/core).
   */
  async _connectCDP(wsUrl) {
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
      /* istanbul ignore next */
      try { msg = JSON.parse(raw.toString()); } catch { return; }

      if (msg.id && _pending.has(msg.id)) {
        const { resolve, reject } = _pending.get(msg.id);
        _pending.delete(msg.id);
        /* istanbul ignore next */
        if (msg.error) {
          reject(new Error(msg.error.message));
        } else {
          resolve(msg.result ?? {});
        }
      }

      if (msg.method) {
        /* istanbul ignore next */
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

  // ─── Private: capture ──────────────────────────────────────────────────────

  /**
   * Launch Chrome, capture network activity, and return raw results.
   * Races the capture against a hard deadline (timeout + 15 s).
   */
  /* istanbul ignore next */
  async _captureNetworkRequests(chromePath, targetUrl, opts = {}) {
    const { timeout = 30000, proxyUrl } = opts;
    // Hard wall-clock cap: navigation timeout + 15 s for Chrome startup + CDP handshake.
    // If Chrome hangs (e.g. frozen renderer, hung SIGTERM), this ensures we always
    // return within a bounded time rather than blocking the whole doctor run.
    const hardDeadline = timeout + 15000;
    const timeoutResult = {
      targetUrl,
      proxyUrl: proxyUrl ?? null,
      navMs: 0,
      requests: [],
      proxyHeaders: [],
      error: `Browser capture timed out after ${hardDeadline / 1000}s`
    };
    return Promise.race([
      this._doCapture(chromePath, targetUrl, opts),
      new Promise(resolve => setTimeout(() => resolve(timeoutResult), hardDeadline))
    ]);
  }

  /* istanbul ignore next */
  async _doCapture(chromePath, targetUrl, opts = {}) {
    const { headless = true, timeout = 30000, proxyUrl } = opts;
    const chromeProxyUrl = sanitizeProxyForChrome(proxyUrl);

    // Re-validate at the sink to keep the child_process usage safe even if this
    // method is called directly in tests or from future code paths.
    const safeChromePath = sanitizeExecutablePath(chromePath);
    /* istanbul ignore next */
    if (!safeChromePath || !fs.existsSync(safeChromePath)) {
      throw new Error('Invalid Chrome executable path');
    }

    // When NODE_TLS_REJECT_UNAUTHORIZED=0 is set the Node process has already
    // disabled SSL verification (e.g. for an SSL-intercepting proxy). Mirror that
    // into Chrome via two mechanisms:
    //   1. --ignore-certificate-errors CLI flag (broad bypass, works for most cases)
    //   2. Security.setIgnoreCertificateErrors CDP command (per-session, more reliable
    //      for intercepting proxies — this is how Puppeteer/Playwright do it)
    const ignoreCerts = process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0';

    const port = await this.#getFreePort();
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
      chromeProxyUrl ? `--proxy-server=${chromeProxyUrl}` : '',
      'about:blank'
    ].filter(Boolean);

    // nosemgrep: javascript.lang.security.detect-child-process.detect-child-process --- IGNORE
    const proc = spawn(safeChromePath, chromeArgs, {
      stdio: ['ignore', 'ignore', 'pipe'],
      detached: false,
      shell: false // args are always an array; never expand via shell
    });

    let chromeStderr = '';
    proc.stderr?.on('data', chunk => {
      const next = String(chunk ?? '');
      if (!next) return;
      chromeStderr = (chromeStderr + next).slice(0, 4000);
    });

    const capture = new NetworkCapture();
    let captureError = null;
    let navMs = 0;

    try {
      const wsUrl = await this._waitForCDP(port, Math.max(timeout, 30000));
      const cdp = await this._connectCDP(wsUrl);

      // Attach event handlers — mirrors the watch() pattern in @percy/core's Network class
      cdp.on('Network.requestWillBeSent', p => capture.onRequestWillBeSent(p));
      cdp.on('Network.responseReceived', p => capture.onResponseReceived(p));
      cdp.on('Network.loadingFailed', p => capture.onLoadingFailed(p));

      await Promise.all([
        cdp.send('Network.enable'),
        cdp.send('Page.enable')
      ]);

      // Per-session SSL bypass — more reliable than the CLI flag for intercepting
      // proxies (the flag sometimes doesn't fire in headless=new for CONNECT tunnels).
      if (ignoreCerts) {
        await cdp.send('Security.setIgnoreCertificateErrors', { ignore: true });
      }

      const navStart = Date.now();
      await cdp.send('Page.navigate', { url: targetUrl });
      await Promise.race([
        new Promise(resolve => cdp.on('Page.loadEventFired', () => setTimeout(resolve, 2500))),
        new Promise(resolve => setTimeout(resolve, timeout))
      ]);
      navMs = Date.now() - navStart;

      cdp.close();

      // Allow any in-flight async lifecycle handlers (onResponseReceived,
      // onLoadingFailed) to fully settle before collecting results
      await new Promise(resolve => setImmediate(resolve));
    } catch (err) {
      captureError = err.message;
    } finally {
      try { proc.kill('SIGTERM'); } catch { /* ignore */ }
      await this._killProcess(proc, 3000);
    }

    return {
      targetUrl,
      proxyUrl: proxyUrl ?? null,
      navMs,
      requests: capture.buildRequests(),
      proxyHeaders: capture.getProxyHeaders(),
      error: captureError
        ? `${captureError}${chromeStderr ? ` | Chrome stderr: ${chromeStderr.trim().slice(0, 500)}` : ''}`
        : null
    };
  }

  /**
   * Terminate a child process gracefully (SIGTERM), escalating to SIGKILL after
   * `gracePeriodMs` if it hasn't exited. Handles the race where the process has
   * already exited so `proc.once('exit')` would never fire.
   */
  _killProcess(proc, gracePeriodMs = 3000) {
    return new Promise(resolve => {
      // Already dead — nothing to do
      if (proc.exitCode !== null || proc.killed) return resolve();

      const escalate = setTimeout(() => {
        try { proc.kill('SIGKILL'); } catch { /* already gone */ }
        // One final wait; if it still doesn't fire we move on
        const bail = setTimeout(resolve, 2000);
        proc.once('exit', () => { clearTimeout(bail); resolve(); });
      }, gracePeriodMs);

      /* istanbul ignore next */
      proc.once('exit', () => { clearTimeout(escalate); resolve(); });
    });
  }

  // ─── Public API ─────────────────────────────────────────────────────────────

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
  async checkBrowserNetwork(options = {}) {
    const {
      targetUrl = 'https://percy.io',
      proxyUrl,
      timeout = 30000,
      headless = true
    } = options;

    const notes = [];
    if (proxyUrl) {
      try {
        const p = new URL(proxyUrl);
        /* istanbul ignore next */
        if (p.username || p.password) {
          /* istanbul ignore next */
          notes.push({
            status: 'info',
            message: 'Proxy credentials detected but not passed to Chrome (security: not exposed in process args).',
            suggestions: ['Chrome browser check runs without proxy auth. Results may differ from authenticated access.']
          });
        }
      } catch { /* ignore malformed proxy URL */ }
    }

    // ── 1. Find Chrome ───────────────────────────────────────────────────────
    const chromePath = await this.#findChrome();

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

    // ── 2 & 3. Direct + proxy captures in parallel ──────────────────────────
    const errCapture = (url, pUrl, msg) => ({
      targetUrl: url,
      proxyUrl: pUrl,
      navMs: 0,
      requests: [],
      proxyHeaders: [],
      error: msg
    });

    const [directResult, proxyResult] = await Promise.allSettled([
      this._captureNetworkRequests(chromePath, targetUrl, { headless, timeout }),
      proxyUrl
        ? this._captureNetworkRequests(chromePath, targetUrl, { headless, timeout, proxyUrl })
        : Promise.resolve(null)
    ]);

    const directCapture = directResult.status === 'fulfilled'
      ? directResult.value
      : errCapture(targetUrl, null, directResult.reason?.message ?? 'capture failed');

    /* istanbul ignore next */
    const proxyCapture = proxyResult.status === 'fulfilled'
      ? proxyResult.value
      : (proxyUrl ? errCapture(targetUrl, proxyUrl, proxyResult.reason?.message ?? 'capture failed') : null);

    // ── 4. Build domain-level summary ────────────────────────────────────────
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
    /* istanbul ignore next */
    domainSummary.sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9));

    // ── 5. Aggregate proxy headers ───────────────────────────────────────────
    const proxyHeaders = [
      ...new Set([
        ...directCapture.proxyHeaders,
        ...(proxyCapture?.proxyHeaders ?? [])
      ])
    ];

    // ── 6. Overall status ────────────────────────────────────────────────────
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
      error: directCapture.error,
      notes
    };
  }
}
