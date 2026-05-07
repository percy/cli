// Cross-platform view-hierarchy resolver for /percy/maestro-screenshot element regions.
//
// Caller dispatches by platform via `dump({ platform: 'android' | 'ios' })`. Same
// public API for both; platform-specific attribute key mapping happens internally
// in `flattenMaestroNodes` (Android TreeNode shape; iOS CLI fallback shape) or
// `flattenIosAxElement` (iOS HTTP path raw AXElement shape).
//
// Selector vocabulary in V1:
//   Android — `resource-id`, `text`, `content-desc`, `class`, plus `id` as alias
//             for `resource-id` (R1 vocabulary parity).
//   iOS     — `id` only (maps to `resource-id` populated from AXElement.identifier).
//             Maestro's own iOS TreeNode does not carry `class` (per
//             IOSDriver.mapViewHierarchy at cli-2.0.7), so Percy keeps iOS
//             selector vocabulary aligned with that capability.
//
// Bounds canonicalize to a bracket-format string `[X,Y][X+W,Y+H]` regardless
// of platform; firstMatch() parses to `{x, y, width, height}` integers.
//
// Android primary: `maestro --udid <serial> hierarchy` (rides Maestro's existing
// gRPC connection to dev.mobile.maestro on the device).
// adb fallback: `adb exec-out uiautomator dump` for environments without maestro.
//
// iOS primary: HTTP POST to Maestro's iOS XCTestRunner /viewHierarchy endpoint
// at http://127.0.0.1:${PERCY_IOS_DRIVER_HOST_PORT}/viewHierarchy. Sends
// `{appIds: [], excludeKeyboardElements: false}` — at cli-2.0.7+ the runner
// detects the AUT itself via RunningApp.getForegroundApp() (Maestro PR #2365).
// On older Maestro versions empty `appIds` returns SpringBoard; the parser
// detects that and routes to the maestro-CLI fallback below.
// iOS fallback: `maestro --udid <udid> --driver-host-port <P> hierarchy` —
// CLI shell-out path (knows the AUT internally via Maestro flow context).
//
// Reads process.env.ANDROID_SERIAL (Android) or PERCY_IOS_DEVICE_UDID +
// PERCY_IOS_DRIVER_HOST_PORT (iOS) — never accepts device addressing from user
// input. Honors MAESTRO_BIN env var on both platforms.

import http from 'http';
import spawn from 'cross-spawn';
import { XMLParser } from 'fast-xml-parser';
import logger from '@percy/logger';

const log = logger('core:maestro-hierarchy');

const DUMP_TIMEOUT_MS = 2000;
const MAESTRO_TIMEOUT_MS = 15000; // JVM cold start is ~9s; +6s headroom
const MAX_DUMP_BYTES = 5 * 1024 * 1024;
const SIGKILL_EXIT = 137; // 128 + SIGKILL; uiautomator often hits this under device contention
// Backoff delays for the SIGKILL retry loop — covers a ~3.5s window total, which is
// long enough to outlast most Maestro takeScreenshot → uiautomator-settle windows
// while staying within a reasonable per-screenshot budget.
const SIGKILL_RETRY_DELAYS_MS = [500, 1000, 2000];
// Android-side V1 selector vocabulary plus `id` as alias for `resource-id`
// (R1 vocabulary parity). The iOS branch uses `id` only — Maestro's iOS
// TreeNode does not carry `class` (per IOSDriver.mapViewHierarchy at cli-2.0.7),
// and Percy keeps iOS selector vocabulary aligned with that capability.
// Customers see one union whitelist for handler-side validation; firstMatch
// dispatches per-platform via the node shape (Android nodes have resource-id;
// iOS nodes have identifier surfaced as `id` and `resource-id`).
const ANDROID_SELECTOR_KEYS = ['resource-id', 'text', 'content-desc', 'class', 'id'];
const IOS_SELECTOR_KEYS = ['id'];
// Union whitelist exported for api.js handler-side validation. firstMatch
// itself uses node-shape lookups so the per-platform divergence is implicit.
const SELECTOR_KEYS_UNION = ['resource-id', 'text', 'content-desc', 'class', 'id'];

// iOS HTTP transport tunables (mirrors PR #2210's gRPC pattern).
// Healthy deadline is the per-call socket-timeout budget; circuit-breaker is
// the Promise.race outer bound that protects against the runner stalling
// past the socket timeout.
const IOS_HTTP_HEALTHY_DEADLINE_MS = 1500;
const IOS_HTTP_CIRCUIT_BREAKER_MS = 5000;
// Maestro iOS driver-host-port is realmobile-derived as wda_port + 2700.
// WDA ports are 8400-8410 → driver host ports are 11100-11110.
const IOS_DRIVER_HOST_PORT_MIN = 11100;
const IOS_DRIVER_HOST_PORT_MAX = 11110;
// HTTP response cap (matches wda-hierarchy.js SOURCE_MAX_BYTES).
const IOS_HTTP_RESPONSE_MAX_BYTES = 20 * 1024 * 1024;

// Two-slot drift bit (Unit 4). Records the first schema-class failure per
// platform so /percy/healthcheck can surface contract drift to ops. Each
// slot is monotonic — once set, only the first occurrence's `firstSeenAt`
// is preserved. Future Android-side resolver work (e.g., PR #2210's gRPC
// path) will populate the `android` slot via the same setter.
//
// Single-author note: this branch doesn't yet have PR #2210's
// `recordSchemaDrift` code (#2210 sits on a sibling branch off PR #2202).
// When #2210 merges to master and this PR rebases, the rebase will need
// to retrofit #2210's Android-side schema-class call sites to use the
// setter exported here. Companion artifact:
// percy-maestro/docs/plans/2026-05-06-004-pr2210-coordination-comment.md.
let maestroHierarchyDrift = { android: null, ios: null };

const BOUNDS_RE = /^\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]$/;
const UNAVAILABLE_STDERR_RE = /no devices|unauthorized|device offline/i;
const MAESTRO_UNAVAILABLE_STDERR_RE = /No connected devices|Device not found|Could not connect/i;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  parseAttributeValue: false,
  trimValues: true,
  processEntities: false,
  allowBooleanAttributes: false
});

// Generic spawn-with-timeout wrapper used by both the maestro and adb code paths.
// Mirrors the async spawn + timeout + cleanup pattern from browser.js:256-297.
// Returns { stdout, stderr, exitCode, timedOut, spawnError, oversize }.
function spawnWithTimeout(cmd, args, { timeoutMs } = {}) {
  return new Promise(resolve => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let settled = false;

    let proc;
    try {
      proc = spawn(cmd, args);
    } catch (err) {
      resolve({ spawnError: err });
      return;
    }

    const settle = result => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      proc.stdout?.off('data', onStdout);
      proc.stderr?.off('data', onStderr);
      proc.off('exit', onExit);
      proc.off('error', onError);
      resolve(result);
    };

    const onStdout = chunk => {
      stdout += chunk.toString();
      if (stdout.length > MAX_DUMP_BYTES) {
        try { proc.kill('SIGKILL'); } catch { /* already dead */ }
        settle({ stdout: '', stderr, exitCode: 1, oversize: true });
      }
    };
    const onStderr = chunk => { stderr += chunk.toString(); };
    const onExit = code => settle({ stdout, stderr, exitCode: code ?? 1, timedOut });
    const onError = err => settle({ spawnError: err });

    const timeoutId = setTimeout(() => {
      timedOut = true;
      try { proc.kill('SIGKILL'); } catch { /* already dead */ }
      settle({ stdout, stderr, exitCode: null, timedOut: true });
    }, timeoutMs ?? DUMP_TIMEOUT_MS);

    proc.stdout?.on('data', onStdout);
    proc.stderr?.on('data', onStderr);
    proc.on('exit', onExit);
    proc.on('error', onError);
  });
}

// Maestro CLI path: honor MAESTRO_BIN env var (mobile-repo or deploy config sets this),
// fall back to plain `maestro` on PATH. Never accepts a path from untrusted input.
function defaultMaestroBin(getEnv) {
  return getEnv('MAESTRO_BIN') || 'maestro';
}

async function defaultExecMaestro(args, getEnv) {
  const bin = defaultMaestroBin(getEnv);
  return spawnWithTimeout(bin, args, { timeoutMs: MAESTRO_TIMEOUT_MS });
}

// Preserved for the adb fallback code path (signature unchanged — existing tests
// pass a fake execAdb and assert -s <serial> is forwarded).
async function defaultExecAdb(args) {
  return new Promise(resolve => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let settled = false;

    let proc;
    try {
      proc = spawn('adb', args);
    } catch (err) {
      resolve({ spawnError: err });
      return;
    }

    const settle = result => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      proc.stdout?.off('data', onStdout);
      proc.stderr?.off('data', onStderr);
      proc.off('exit', onExit);
      proc.off('error', onError);
      resolve(result);
    };

    const onStdout = chunk => {
      stdout += chunk.toString();
      if (stdout.length > MAX_DUMP_BYTES) {
        try { proc.kill('SIGKILL'); } catch { /* already dead */ }
        settle({ stdout: '', stderr, exitCode: 1, oversize: true });
      }
    };
    const onStderr = chunk => { stderr += chunk.toString(); };
    const onExit = code => settle({ stdout, stderr, exitCode: code ?? 1, timedOut });
    const onError = err => settle({ spawnError: err });

    const timeoutId = setTimeout(() => {
      timedOut = true;
      try { proc.kill('SIGKILL'); } catch { /* already dead */ }
      settle({ stdout, stderr, exitCode: null, timedOut: true });
    }, DUMP_TIMEOUT_MS);

    proc.stdout?.on('data', onStdout);
    proc.stderr?.on('data', onStderr);
    proc.on('exit', onExit);
    proc.on('error', onError);
  });
}

function defaultGetEnv(key) {
  return process.env[key];
}

function classifyAdbFailure(result) {
  if (result.spawnError) {
    const code = result.spawnError.code;
    if (code === 'ENOENT') return { kind: 'unavailable', reason: 'adb-not-found' };
    return { kind: 'unavailable', reason: `spawn-error:${code || 'unknown'}` };
  }
  if (result.timedOut) return { kind: 'unavailable', reason: 'timeout' };
  if (result.oversize) return { kind: 'dump-error', reason: 'oversize' };
  if (UNAVAILABLE_STDERR_RE.test(result.stderr || '')) {
    if (/unauthorized/i.test(result.stderr)) return { kind: 'unavailable', reason: 'device-unauthorized' };
    if (/no devices/i.test(result.stderr)) return { kind: 'unavailable', reason: 'no-device' };
    return { kind: 'unavailable', reason: 'device-offline' };
  }
  return null;
}

// Resolve device serial: prefer ANDROID_SERIAL env; else probe `adb devices`
// and require exactly one device.
async function resolveSerial({ execAdb, getEnv }) {
  const fromEnv = getEnv('ANDROID_SERIAL');
  if (fromEnv) return { serial: fromEnv };

  const probe = await execAdb(['devices']);
  const fail = classifyAdbFailure(probe);
  if (fail) return { classification: fail };

  if ((probe.exitCode ?? 1) !== 0) {
    return { classification: { kind: 'unavailable', reason: `adb-devices-exit-${probe.exitCode}` } };
  }

  const serials = (probe.stdout || '')
    .split('\n')
    .map(line => {
      const m = line.match(/^(\S+)\s+device\s*$/);
      return m ? m[1] : null;
    })
    .filter(Boolean);

  if (serials.length === 0) {
    return { classification: { kind: 'unavailable', reason: 'no-device' } };
  }
  if (serials.length > 1) {
    return { classification: { kind: 'unavailable', reason: 'multi-device-no-serial' } };
  }
  return { serial: serials[0] };
}

// Slice the XML envelope: first '<?xml' through first '</hierarchy>' (inclusive).
// Discards trailer lines like "UI hierarchy dumped to: /dev/tty" and defends
// against adversarial apps emitting multiple XML blocks in text attributes.
function sliceXmlEnvelope(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const start = raw.indexOf('<?xml');
  if (start < 0) return null;
  const endIdx = raw.indexOf('</hierarchy>', start);
  if (endIdx < 0) return null;
  return raw.slice(start, endIdx + '</hierarchy>'.length);
}

function flattenNodes(parsed) {
  const nodes = [];
  const walk = obj => {
    if (!obj || typeof obj !== 'object') return;
    if (Array.isArray(obj)) {
      for (const item of obj) walk(item);
      return;
    }
    // Attribute keys are prefixed with '@_'; a node with any attributes
    // (we only keep the four selector attrs + bounds) is a candidate.
    const resourceId = obj['@_resource-id'];
    const node = {
      'resource-id': resourceId,
      // Android `id` alias for R1 vocabulary parity — same value as resource-id.
      id: resourceId,
      text: obj['@_text'],
      'content-desc': obj['@_content-desc'],
      class: obj['@_class'],
      bounds: obj['@_bounds']
    };
    if (resourceId || node.text || node['content-desc'] || node.class) {
      nodes.push(node);
    }
    // Recurse into children — any non-'@_' key is a nested element or array of elements.
    for (const key of Object.keys(obj)) {
      if (key.startsWith('@_')) continue;
      if (key === '#text') continue;
      walk(obj[key]);
    }
  };
  walk(parsed);
  return nodes;
}

async function runDump(args, execAdb) {
  const result = await execAdb(args);
  const fail = classifyAdbFailure(result);
  if (fail) return fail;
  if ((result.exitCode ?? 1) !== 0) {
    return { kind: 'dump-error', reason: `exit-${result.exitCode}` };
  }
  const slice = sliceXmlEnvelope(result.stdout);
  if (!slice) return { kind: 'dump-error', reason: 'no-xml-envelope' };
  try {
    const parsed = parser.parse(slice);
    const nodes = flattenNodes(parsed);
    return { kind: 'hierarchy', nodes };
  } catch (err) {
    return { kind: 'dump-error', reason: `parse-error:${err.message}` };
  }
}

// Classify a maestro hierarchy invocation result.
// Maestro exits 0 on success, non-zero on device-not-found / connection-error / etc.
function classifyMaestroFailure(result) {
  if (result.spawnError) {
    const code = result.spawnError.code;
    if (code === 'ENOENT') return { kind: 'unavailable', reason: 'maestro-not-found' };
    return { kind: 'unavailable', reason: `maestro-spawn-error:${code || 'unknown'}` };
  }
  if (result.timedOut) return { kind: 'unavailable', reason: 'maestro-timeout' };
  if (result.oversize) return { kind: 'dump-error', reason: 'maestro-oversize' };
  const stderr = result.stderr || '';
  if (MAESTRO_UNAVAILABLE_STDERR_RE.test(stderr)) {
    return { kind: 'unavailable', reason: 'maestro-no-device' };
  }
  return null;
}

// Flatten a maestro JSON tree (Android shape) into the canonical node shape.
// Maps accessibilityText → content-desc; surfaces resource-id under both
// `resource-id` and `id` for R1 vocabulary parity (customers writing
// `{element: {id: "X"}}` resolve the same node as `{element: {resource-id: "X"}}`).
function flattenMaestroNodes(root) {
  const nodes = [];
  const walk = obj => {
    if (!obj || typeof obj !== 'object') return;
    const attrs = obj.attributes;
    if (attrs && typeof attrs === 'object') {
      const resourceId = attrs['resource-id'];
      const node = {
        'resource-id': resourceId,
        // Android `id` alias: same value as resource-id; lets cross-platform
        // selector vocabulary work without forcing customers to know the
        // platform-specific key name. Per R1 of the 2026-04-27 plan.
        id: resourceId,
        text: attrs.text,
        'content-desc': attrs.accessibilityText,
        class: attrs.class,
        bounds: attrs.bounds
      };
      if (resourceId || node.text || node['content-desc'] || node.class) {
        nodes.push(node);
      }
    }
    const children = obj.children;
    if (Array.isArray(children)) {
      for (const child of children) walk(child);
    }
  };
  walk(root);
  return nodes;
}

// Drift-bit setter. First-seen-per-platform wins; subsequent same-platform
// writes are no-ops to preserve the original `firstSeenAt`. Unknown platform
// values are silently ignored — the setter is internal and the call sites
// pass static literals.
function setMaestroHierarchyDrift({ platform, code, reason }) {
  if (platform !== 'android' && platform !== 'ios') return;
  if (maestroHierarchyDrift[platform]) return;
  maestroHierarchyDrift[platform] = {
    code,
    reason,
    firstSeenAt: new Date().toISOString()
  };
}

// Public reader for /percy/healthcheck. Always returns the full envelope;
// both slots are `null` in steady state. Consumers (api.js healthcheck
// handler, ops dashboards) must check both slots independently.
export function getMaestroHierarchyDrift() {
  return maestroHierarchyDrift;
}

// Test helper — resets both slots between specs. Not exported on the public
// surface (consumers shouldn't reset module state in production). The default
// export `__testing` namespace mirrors PR #2210's pattern.
export const __testing = {
  resetMaestroHierarchyDrift() {
    maestroHierarchyDrift = { android: null, ios: null };
  }
};

// Default Node http.request wrapper. Returns
//   { statusCode, headers, body }
// on completed responses (any status code), or throws an Error with .code
// (e.g. ECONNREFUSED, ETIMEDOUT, ECONNRESET) on transport failures.
//
// Tests inject a fake httpRequest with the same shape; see
// makeFakeHttpRequest in maestro-hierarchy.test.js iOS HTTP describe block.
function defaultHttpRequest({ host, port, method, path: requestPath, headers, body, timeoutMs }) {
  return new Promise((resolve, reject) => {
    let chunks = [];
    let totalBytes = 0;

    const req = http.request({ host, port, method, path: requestPath, headers, timeout: timeoutMs }, res => {
      res.on('data', chunk => {
        totalBytes += chunk.length;
        if (totalBytes > IOS_HTTP_RESPONSE_MAX_BYTES) {
          // Cap before parse — defensive against runaway responses.
          chunks = null;
          try { req.destroy(); } catch { /* already destroyed */ }
          reject(Object.assign(new Error('response-too-large'), { code: 'EMSGSIZE' }));
          return;
        }
        if (chunks) chunks.push(chunk);
      });
      res.on('end', () => {
        if (!chunks) return; // already rejected for size
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body: Buffer.concat(chunks).toString('utf8')
        });
      });
      res.on('error', reject);
    });

    req.on('timeout', () => {
      try { req.destroy(); } catch { /* already destroyed */ }
      reject(Object.assign(new Error('socket-timeout'), { code: 'ETIMEDOUT' }));
    });
    req.on('error', reject);

    if (body !== undefined && body !== null) req.write(body);
    req.end();
  });
}

// Validate PERCY_IOS_DRIVER_HOST_PORT env value as integer in the realmobile
// range (wda_port + 2700 = 11100-11110). Out-of-range values return null.
function parseIosDriverHostPort(raw) {
  if (raw === undefined || raw === null || raw === '') return null;
  const n = Number(raw);
  if (!Number.isInteger(n)) return null;
  if (n < IOS_DRIVER_HOST_PORT_MIN || n > IOS_DRIVER_HOST_PORT_MAX) return null;
  return n;
}

// Walk the AXElement tree from cli-2.0.7's HTTP /viewHierarchy response.
// Find the AUT root: first node with `elementType === 1` (XCUI application)
// whose `identifier !== 'com.apple.springboard'`. Returns the AUT subtree, OR
// null if the only application is SpringBoard (AUT-not-running case).
//
// At cli-2.0.7 the wrap is `[appHierarchy, statusBarsContainer]` where the
// statusBars container has `elementType: 0` (synthetic init). The AUT is the
// first elementType==1 node and the rule selects it directly.
//
// At cli-1.39.13 the wrap was `[springboardHierarchy, appHierarchy]` where
// both children have `elementType: 1`. The springboard-skip handles that.
//
// Post-PR-2402 forward-compat: when the response is a single-AUT root (no
// wrap), the rule selects the root itself.
function findAxAutRoot(axElement) {
  if (!axElement || typeof axElement !== 'object') return null;
  if (axElement.elementType === 1 && axElement.identifier !== 'com.apple.springboard') {
    return axElement;
  }
  const children = axElement.children;
  if (Array.isArray(children)) {
    for (const child of children) {
      const found = findAxAutRoot(child);
      if (found) return found;
    }
  }
  return null;
}

// Adapter: walk an AXElement subtree (HTTP /viewHierarchy path) and emit nodes
// in the canonical shape that firstMatch consumes for Android. Specifically:
//   { 'resource-id': identifier, id: identifier, bounds: '[X,Y][X+W,Y+H]' }
// Notably no `class` attribute — Maestro's iOS TreeNode doesn't expose
// elementType→class either, and Percy keeps both iOS paths symmetric.
//
// Returns an array of nodes; throws if any frame is malformed (caught by
// caller and surfaced as schema-class drift).
function flattenIosAxElement(axRoot) {
  const nodes = [];
  const walk = obj => {
    if (!obj || typeof obj !== 'object') return;
    const identifier = typeof obj.identifier === 'string' ? obj.identifier : '';
    const frame = obj.frame;
    if (!frame || typeof frame !== 'object') {
      throw new Error(`missing-frame on identifier=${JSON.stringify(identifier).slice(0, 64)}`);
    }
    const x = frame.X;
    const y = frame.Y;
    const w = frame.Width;
    const h = frame.Height;
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(w) || !Number.isFinite(h)) {
      throw new Error(`frame-key-case-mismatch on identifier=${JSON.stringify(identifier).slice(0, 64)}`);
    }
    const bounds = `[${Math.round(x)},${Math.round(y)}][${Math.round(x + w)},${Math.round(y + h)}]`;
    if (identifier) {
      nodes.push({
        'resource-id': identifier,
        id: identifier,
        // text/content-desc/class deliberately undefined — iOS Maestro doesn't
        // surface these as selector-relevant attributes (per IOSDriver.kt).
        bounds
      });
    }
    if (Array.isArray(obj.children)) {
      for (const child of obj.children) walk(child);
    }
  };
  walk(axRoot);
  return nodes;
}

// Classify an iOS HTTP failure into connection-class (route to fallback) vs
// schema-class (set drift bit, no fallback) vs no-aut-tree (route to
// fallback because the Maestro CLI knows the AUT internally).
function classifyIosHttpFailure(err) {
  if (!err) return null;
  const code = err.code;
  // Connection-class errors — Maestro runner unreachable / unhealthy. Fall back.
  if (code === 'ECONNREFUSED' || code === 'ETIMEDOUT' || code === 'ECONNRESET' ||
      code === 'EHOSTUNREACH' || code === 'ENETUNREACH' || code === 'EPIPE' ||
      code === 'ECONNABORTED' || code === 'EMSGSIZE') {
    return { kind: 'connection-fail', reason: `http-${String(code).toLowerCase()}` };
  }
  // Default: treat unknown errors as connection-class so we fall back rather
  // than silently skip element regions.
  return { kind: 'connection-fail', reason: `http-${err.message?.slice(0, 64) || 'unknown'}` };
}

// iOS HTTP primary path. POSTs `{appIds: [], excludeKeyboardElements: false}`
// to Maestro's iOS XCTestRunner /viewHierarchy endpoint. Returns
//   { kind: 'hierarchy', nodes }     on success
//   { kind: 'connection-fail', ... } on transport / 5xx / out-of-range port
//   { kind: 'no-aut-tree', ... }     on SpringBoard-only response
//   { kind: 'dump-error', ... }      on schema-class failures (no fallback)
async function runIosHttpDump({ port, sessionId, httpRequest = defaultHttpRequest }) {
  // Loopback-only guard. Hardcoded host; do not accept from caller input.
  const host = '127.0.0.1';

  let response;
  const requestBody = JSON.stringify({ appIds: [], excludeKeyboardElements: false });
  try {
    response = await Promise.race([
      httpRequest({
        host,
        port,
        method: 'POST',
        path: '/viewHierarchy',
        headers: {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(requestBody)
        },
        body: requestBody,
        timeoutMs: IOS_HTTP_HEALTHY_DEADLINE_MS
      }),
      new Promise((_, reject) => setTimeout(
        () => reject(Object.assign(new Error('circuit-breaker'), { code: 'ETIMEDOUT' })),
        IOS_HTTP_CIRCUIT_BREAKER_MS
      ))
    ]);
  } catch (err) {
    return classifyIosHttpFailure(err);
  }

  const { statusCode, headers, body } = response;

  // 5xx → connection-class (server reachable but unhealthy).
  if (statusCode >= 500) {
    return { kind: 'connection-fail', reason: `http-${statusCode}` };
  }
  // 4xx → schema-class (request shape problem; fallback wouldn't help).
  if (statusCode >= 400) {
    return { kind: 'dump-error', reason: `http-${statusCode}-bad-request-shape` };
  }
  // 3xx → unexpected; treat as schema-class.
  if (statusCode !== 200) {
    return { kind: 'dump-error', reason: `http-unexpected-status-${statusCode}` };
  }

  // Content-type check.
  const contentType = headers && (headers['content-type'] || headers['Content-Type']);
  if (!contentType || !/application\/json/i.test(contentType)) {
    return { kind: 'dump-error', reason: 'http-non-json-content-type' };
  }

  // Parse JSON.
  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch (err) {
    return { kind: 'dump-error', reason: `http-parse-error:${err.message?.slice(0, 64) || 'unknown'}` };
  }

  // Schema validation: require `axElement` root.
  if (!parsed || typeof parsed !== 'object' || !parsed.axElement || typeof parsed.axElement !== 'object') {
    return { kind: 'dump-error', reason: 'http-missing-root' };
  }

  // Find AUT root, skipping SpringBoard.
  const aut = findAxAutRoot(parsed.axElement);
  if (!aut) {
    // Either the response is SpringBoard-only (AUT not running), or no
    // application node at all. Either way, route to fallback.
    return { kind: 'no-aut-tree', reason: 'springboard-only' };
  }

  // Flatten the AUT subtree to firstMatch's expected node shape.
  let nodes;
  try {
    nodes = flattenIosAxElement(aut);
  } catch (err) {
    const msg = err.message || 'unknown';
    if (/^missing-frame/.test(msg)) return { kind: 'dump-error', reason: 'http-missing-frame' };
    if (/^frame-key-case-mismatch/.test(msg)) return { kind: 'dump-error', reason: 'http-frame-key-case-mismatch' };
    return { kind: 'dump-error', reason: `http-flatten-error:${msg.slice(0, 64)}` };
  }
  // Suppress sessionId in log surface — only emit a hash-prefix so support can
  // correlate without leaking the full id.
  const sidTag = sessionId ? `sid=${String(sessionId).slice(0, 8)}…` : 'sid=none';
  log.debug(`runIosHttpDump ok ${sidTag} nodes=${nodes.length}`);
  return { kind: 'hierarchy', nodes };
}

// iOS maestro-CLI fallback path (replaces the iOS-WIP "Phase 0.5 stub").
// Spawns `maestro --udid <udid> --driver-host-port <port> hierarchy` and
// parses stdout (Maestro's normalized TreeNode shape, identical to Android).
// Existing flattenMaestroNodes consumes TreeNode unchanged — no iOS-specific
// branching needed on this path.
async function runMaestroIosDump(udid, driverHostPort, execMaestro, getEnv) {
  const result = await execMaestro(['--udid', udid, '--driver-host-port', String(driverHostPort), 'hierarchy'], getEnv);
  const fail = classifyMaestroFailure(result);
  if (fail) return fail;
  if ((result.exitCode ?? 1) !== 0) {
    return { kind: 'dump-error', reason: `maestro-exit-${result.exitCode}` };
  }
  const stdout = result.stdout || '';
  const start = stdout.indexOf('{');
  if (start < 0) return { kind: 'dump-error', reason: 'maestro-no-json' };
  try {
    const parsed = JSON.parse(stdout.slice(start));
    const nodes = flattenMaestroNodes(parsed);
    return { kind: 'hierarchy', nodes };
  } catch (err) {
    return { kind: 'dump-error', reason: `maestro-parse-error:${err.message}` };
  }
}

async function runMaestroDump(serial, execMaestro, getEnv) {
  const result = await execMaestro(['--udid', serial, 'hierarchy'], getEnv);
  const fail = classifyMaestroFailure(result);
  if (fail) return fail;
  if ((result.exitCode ?? 1) !== 0) {
    return { kind: 'dump-error', reason: `maestro-exit-${result.exitCode}` };
  }
  // Maestro prints the JSON to stdout; sometimes CLI prefixes a banner/notice line.
  // Slice from the first '{' to be safe.
  const stdout = result.stdout || '';
  const start = stdout.indexOf('{');
  if (start < 0) return { kind: 'dump-error', reason: 'maestro-no-json' };
  try {
    const parsed = JSON.parse(stdout.slice(start));
    const nodes = flattenMaestroNodes(parsed);
    return { kind: 'hierarchy', nodes };
  } catch (err) {
    return { kind: 'dump-error', reason: `maestro-parse-error:${err.message}` };
  }
}

export async function dump({
  platform = 'android',
  sessionId,
  execAdb = defaultExecAdb,
  execMaestro = defaultExecMaestro,
  httpRequest = defaultHttpRequest,
  getEnv = defaultGetEnv
} = {}) {
  const started = Date.now();

  if (platform === 'ios') {
    // iOS dispatch: read realmobile-injected env vars; warn-skip if absent.
    const udid = getEnv('PERCY_IOS_DEVICE_UDID');
    const driverHostPortRaw = getEnv('PERCY_IOS_DRIVER_HOST_PORT');
    if (!udid || !driverHostPortRaw) {
      log.warn(`iOS resolver env-missing: udid=${udid ? 'set' : 'unset'} driver_port=${driverHostPortRaw ? 'set' : 'unset'}`);
      return { kind: 'unavailable', reason: 'env-missing' };
    }

    // Validate driver-host-port range before attempting HTTP. Out-of-range
    // values skip the HTTP path entirely and fall through to maestro-CLI.
    const driverHostPort = parseIosDriverHostPort(driverHostPortRaw);
    let httpResult = null;
    if (driverHostPort !== null) {
      httpResult = await runIosHttpDump({ port: driverHostPort, sessionId, httpRequest });
      if (httpResult.kind === 'hierarchy') {
        log.debug(`dump took ${Date.now() - started}ms via maestro-http (${httpResult.nodes.length} nodes)`);
        return httpResult;
      }
      if (httpResult.kind === 'dump-error') {
        // Schema-class — no fallback per plan R4. Flip the iOS slot of the
        // drift bit so /percy/healthcheck surfaces the contract mismatch
        // for ops investigation. First-seen-per-platform wins.
        setMaestroHierarchyDrift({ platform: 'ios', code: undefined, reason: httpResult.reason });
        log.warn(`iOS HTTP schema-drift: ${httpResult.reason}`);
        return httpResult;
      }
      // Otherwise (connection-fail or no-aut-tree): fall through to CLI.
      log.debug(`iOS HTTP ${httpResult.kind} (${httpResult.reason}); falling back to maestro-cli`);
    } else {
      log.debug(`PERCY_IOS_DRIVER_HOST_PORT=${driverHostPortRaw} out of range [${IOS_DRIVER_HOST_PORT_MIN}-${IOS_DRIVER_HOST_PORT_MAX}]; using maestro-cli fallback`);
    }

    const cliResult = await runMaestroIosDump(udid, driverHostPort ?? driverHostPortRaw, execMaestro, getEnv);
    const httpReason = httpResult ? `${httpResult.kind}/${httpResult.reason}` : 'out-of-range-port';
    log.debug(`dump took ${Date.now() - started}ms via maestro-cli-fallback (${httpReason}) kind=${cliResult.kind}`);
    return cliResult;
  }

  // Android (default).
  const { serial, classification } = await resolveSerial({ execAdb, getEnv });
  if (classification) {
    log.warn(`adb unavailable: ${classification.reason}`);
    return classification;
  }

  // Primary: `maestro --udid <serial> hierarchy`. Works during a live Maestro flow
  // (maestro reuses its existing gRPC connection to dev.mobile.maestro on the device).
  const maestroResult = await runMaestroDump(serial, execMaestro, getEnv);
  if (maestroResult.kind === 'hierarchy') {
    log.debug(`dump took ${Date.now() - started}ms via maestro (${maestroResult.nodes.length} nodes)`);
    return maestroResult;
  }

  // Fallback: adb exec-out uiautomator dump. Only useful when the maestro binary is
  // absent (maestro-not-found) — if maestro is present but reports unavailable, the
  // device genuinely isn't reachable and adb would hit the same wall. If maestro is
  // present but returned dump-error (e.g., session collision), adb is less likely to
  // succeed than maestro but still worth one try.
  const fellBackFromMaestro = maestroResult.kind;
  log.debug(`maestro path returned ${fellBackFromMaestro} (${maestroResult.reason}); falling back to adb uiautomator`);

  let result = await runDump(['-s', serial, 'exec-out', 'uiautomator', 'dump', '/dev/tty'], execAdb);

  // File-based fallback: for devices/images where exec-out /dev/tty is stubbed.
  const isRetryableDumpError = result.kind === 'dump-error' &&
    (result.reason === 'no-xml-envelope' || /^exit-/.test(result.reason));
  if (isRetryableDumpError) {
    log.debug(`adb primary dump returned ${result.reason}, trying file dump`);
    let dumpToFile = await execAdb(['-s', serial, 'shell', 'uiautomator', 'dump', '/sdcard/window_dump.xml']);
    for (const delay of SIGKILL_RETRY_DELAYS_MS) {
      if ((dumpToFile.exitCode ?? 1) !== SIGKILL_EXIT) break;
      log.debug(`fallback dump was killed (exit ${SIGKILL_EXIT}), retrying after ${delay}ms`);
      await new Promise(r => setTimeout(r, delay));
      dumpToFile = await execAdb(['-s', serial, 'shell', 'uiautomator', 'dump', '/sdcard/window_dump.xml']);
    }
    const dumpFail = classifyAdbFailure(dumpToFile);
    if (dumpFail) return dumpFail;
    if ((dumpToFile.exitCode ?? 1) !== 0) {
      return { kind: 'dump-error', reason: `fallback-dump-exit-${dumpToFile.exitCode}` };
    }
    result = await runDump(['-s', serial, 'exec-out', 'cat', '/sdcard/window_dump.xml'], execAdb);
  }

  log.debug(`dump took ${Date.now() - started}ms via adb (kind=${result.kind})`);
  return result;
}

function parseBounds(str) {
  if (!str) return null;
  const m = BOUNDS_RE.exec(str);
  if (!m) return null;
  const x1 = Number(m[1]);
  const y1 = Number(m[2]);
  const x2 = Number(m[3]);
  const y2 = Number(m[4]);
  if (x2 <= x1 || y2 <= y1) return null;
  return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
}

export function firstMatch(nodes, selector) {
  if (!Array.isArray(nodes) || !selector || typeof selector !== 'object') return null;
  const keys = Object.keys(selector);
  if (keys.length !== 1) return null;
  const key = keys[0];
  if (!SELECTOR_KEYS_UNION.includes(key)) return null;
  const value = selector[key];
  if (typeof value !== 'string' || value.length === 0) return null;

  for (const node of nodes) {
    if (node[key] !== value) continue;
    const bbox = parseBounds(node.bounds);
    if (bbox) return bbox;
  }
  return null;
}

// Exposed for tests + handler-side validation in api.js. Union of platform
// keys; per-platform validation is implicit in the node shape returned by
// dump() — Android nodes carry resource-id/text/content-desc/class plus the
// `id` alias; iOS nodes (Phase 1+ once Unit 2b lands) carry id/class only.
export const SELECTOR_KEYS_WHITELIST = SELECTOR_KEYS_UNION;
export const ANDROID_SELECTOR_KEYS_WHITELIST = ANDROID_SELECTOR_KEYS;
export const IOS_SELECTOR_KEYS_WHITELIST = IOS_SELECTOR_KEYS;
