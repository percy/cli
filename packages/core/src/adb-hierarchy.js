// Android view-hierarchy resolver for /percy/maestro-screenshot element regions.
//
// Android-only. Caller is responsible for platform gating.
// Reads process.env.ANDROID_SERIAL — never accepts device serial from user input.
//
// Primary mechanism: `maestro --udid <serial> hierarchy` — Maestro's own JSON-emitting
// command reuses its existing gRPC connection to the device-side dev.mobile.maestro
// app, which is the only mechanism that works during a live Maestro flow. The adb /
// uiautomator path fails because Maestro holds the uiautomator lock throughout a flow,
// so concurrent dumps from a second client get SIGKILLed.
//
// Fallback: `adb exec-out uiautomator dump` / file dump. Kept for environments where
// the maestro binary is not on PATH (e.g., CLI used outside BrowserStack) and for
// idle-device diagnostics.

import spawn from 'cross-spawn';
import { XMLParser } from 'fast-xml-parser';
import logger from '@percy/logger';

const log = logger('core:adb-hierarchy');

const DUMP_TIMEOUT_MS = 2000;
const MAESTRO_TIMEOUT_MS = 15000; // JVM cold start is ~9s; +6s headroom
const MAX_DUMP_BYTES = 5 * 1024 * 1024;
const SIGKILL_EXIT = 137; // 128 + SIGKILL; uiautomator often hits this under device contention
// Backoff delays for the SIGKILL retry loop — covers a ~3.5s window total, which is
// long enough to outlast most Maestro takeScreenshot → uiautomator-settle windows
// while staying within a reasonable per-screenshot budget.
const SIGKILL_RETRY_DELAYS_MS = [500, 1000, 2000];
const SELECTOR_KEYS = ['resource-id', 'text', 'content-desc', 'class'];
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
    const node = {
      'resource-id': obj['@_resource-id'],
      text: obj['@_text'],
      'content-desc': obj['@_content-desc'],
      class: obj['@_class'],
      bounds: obj['@_bounds']
    };
    if (node['resource-id'] || node.text || node['content-desc'] || node.class) {
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

// Flatten a maestro JSON tree into the same node shape our firstMatch() expects.
// Maps accessibilityText → content-desc; passes through other selector attrs.
function flattenMaestroNodes(root) {
  const nodes = [];
  const walk = obj => {
    if (!obj || typeof obj !== 'object') return;
    const attrs = obj.attributes;
    if (attrs && typeof attrs === 'object') {
      const node = {
        'resource-id': attrs['resource-id'],
        text: attrs.text,
        'content-desc': attrs.accessibilityText,
        class: attrs.class,
        bounds: attrs.bounds
      };
      if (node['resource-id'] || node.text || node['content-desc'] || node.class) {
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
  execAdb = defaultExecAdb,
  execMaestro = defaultExecMaestro,
  getEnv = defaultGetEnv
} = {}) {
  const started = Date.now();

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
  if (!SELECTOR_KEYS.includes(key)) return null;
  const value = selector[key];
  if (typeof value !== 'string' || value.length === 0) return null;

  for (const node of nodes) {
    if (node[key] !== value) continue;
    const bbox = parseBounds(node.bounds);
    if (bbox) return bbox;
  }
  return null;
}

// Exposed for tests — the constants drive handler-side validation in api.js.
export const SELECTOR_KEYS_WHITELIST = SELECTOR_KEYS;
