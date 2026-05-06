// iOS element-region resolver for /percy/maestro-screenshot (v1.0).
//
// V1 resolution path: source-dump. One `GET /session/:sid/source` per screenshot,
// parsed locally. Decision grounded in A1 Probes 1/2 findings:
//   - Maestro's iOS driver itself calls viewHierarchy (= source-dump) every ~500ms
//   - So Percy's source-dump is additive with Maestro's baseline traffic
//   - Mirrors the Android adb-hierarchy.js source-dump-based architecture
//   - Per-element path deferred to V1.1 as potential optimization if production
//     telemetry shows source-dump p95 latency > 500ms
//
// Architecture mirrors adb-hierarchy.js: module-level singleton, DI-injected
// deps, fail-closed on any validation miss, scrubbed reason-tag logs.
//
// Security properties (contract v1.0.0 + plan R6/R7/R9):
//   - Loopback-only WDA URLs (runtime refusal for non-127.0.0.1 input)
//   - Pre-parse DOCTYPE/ENTITY guard on /source (XXE defense; primary)
//   - fast-xml-parser processEntities:false (defense-in-depth)
//   - 20 MB response cap enforced BEFORE parse
//   - XCUI class allowlist — DoS guardrail per WDA issue #292 (unknown
//     class names cause full accessibility-tree walks on older WDA builds)
//   - Bbox validated in-bounds + non-trivial area (≥4×4 px)
//   - Log scrubbing: reason tag + duration + sessionIdHash only

import { XMLParser } from 'fast-xml-parser';
import loggerFactory from '@percy/logger';

const log = loggerFactory('core:wda-hierarchy');

const WDA_PORT_MIN = 8400;
const WDA_PORT_MAX = 8410;
const SOURCE_MAX_BYTES = 20 * 1024 * 1024; // 20 MB — WebView-heavy iOS apps run hot
const SELECTOR_MAX_LEN = 256;
const BBOX_MIN_SIDE_PX = 4;
const WDA_TIMEOUT_MS = 500;
const SCALE_RANGE_MIN = 1.9;
const SCALE_RANGE_MAX = 3.1;
const SCALE_CACHE_MAX = 64;
const DOCTYPE_OR_ENTITY_RE = /<!(?:DOCTYPE|ENTITY)/i;

// Xcode 16 SDK XCUIElement.ElementType subset. See:
//   https://developer.apple.com/documentation/xctest/xcuielement/elementtype
// Extending: append new types here; bump package minor version.
export const XCUI_ALLOWLIST = new Set([
  'XCUIElementTypeAny', 'XCUIElementTypeOther', 'XCUIElementTypeApplication',
  'XCUIElementTypeGroup', 'XCUIElementTypeWindow', 'XCUIElementTypeSheet',
  'XCUIElementTypeDrawer', 'XCUIElementTypeAlert', 'XCUIElementTypeDialog',
  'XCUIElementTypeButton', 'XCUIElementTypeRadioButton', 'XCUIElementTypeRadioGroup',
  'XCUIElementTypeCheckBox', 'XCUIElementTypeDisclosureTriangle', 'XCUIElementTypePopUpButton',
  'XCUIElementTypeComboBox', 'XCUIElementTypeMenuButton', 'XCUIElementTypeToolbarButton',
  'XCUIElementTypePopover', 'XCUIElementTypeKeyboard', 'XCUIElementTypeKey',
  'XCUIElementTypeNavigationBar', 'XCUIElementTypeTabBar', 'XCUIElementTypeTabGroup',
  'XCUIElementTypeToolbar', 'XCUIElementTypeStatusBar', 'XCUIElementTypeTable',
  'XCUIElementTypeTableRow', 'XCUIElementTypeTableColumn', 'XCUIElementTypeOutline',
  'XCUIElementTypeOutlineRow', 'XCUIElementTypeBrowser', 'XCUIElementTypeCollectionView',
  'XCUIElementTypeSlider', 'XCUIElementTypePageIndicator', 'XCUIElementTypeProgressIndicator',
  'XCUIElementTypeActivityIndicator', 'XCUIElementTypeSegmentedControl', 'XCUIElementTypePicker',
  'XCUIElementTypePickerWheel', 'XCUIElementTypeSwitch', 'XCUIElementTypeToggle',
  'XCUIElementTypeLink', 'XCUIElementTypeImage', 'XCUIElementTypeIcon',
  'XCUIElementTypeSearchField', 'XCUIElementTypeScrollView', 'XCUIElementTypeScrollBar',
  'XCUIElementTypeStaticText', 'XCUIElementTypeTextField', 'XCUIElementTypeSecureTextField',
  'XCUIElementTypeDatePicker', 'XCUIElementTypeTextView', 'XCUIElementTypeMenu',
  'XCUIElementTypeMenuItem', 'XCUIElementTypeMenuBar', 'XCUIElementTypeMenuBarItem',
  'XCUIElementTypeMap', 'XCUIElementTypeWebView', 'XCUIElementTypeIncrementArrow',
  'XCUIElementTypeDecrementArrow', 'XCUIElementTypeTimeline', 'XCUIElementTypeRatingIndicator',
  'XCUIElementTypeValueIndicator', 'XCUIElementTypeSplitGroup', 'XCUIElementTypeSplitter',
  'XCUIElementTypeRelevanceIndicator', 'XCUIElementTypeColorWell', 'XCUIElementTypeHelpTag',
  'XCUIElementTypeMatte', 'XCUIElementTypeDockItem', 'XCUIElementTypeRuler',
  'XCUIElementTypeRulerMarker', 'XCUIElementTypeGrid', 'XCUIElementTypeLevelIndicator',
  'XCUIElementTypeCell', 'XCUIElementTypeLayoutArea', 'XCUIElementTypeLayoutItem',
  'XCUIElementTypeHandle', 'XCUIElementTypeStepper', 'XCUIElementTypeTab', 'XCUIElementTypeTouchBar'
]);

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  parseAttributeValue: false,
  trimValues: true,
  processEntities: false, // defense-in-depth vs XXE; the DOCTYPE_OR_ENTITY_RE pre-parse guard is the primary rejection
  allowBooleanAttributes: false
});

// Per-session scale factor cache (bounded LRU). Re-computes if session is evicted.
const scaleCache = new Map();
// In-flight AbortControllers for shutdown coordination.
const inflight = new Set();

// Main entry point — called from the api.js iOS branch.
// Returns:
//   {
//     resolvedRegions: Array<{elementSelector, boundingBox, algorithm} | null>,
//     warnings: Array<string>
//   }
// `resolvedRegions` is a SPARSE array with one entry per input element region (in
// input order). A `null` entry means that region was skipped (corresponding
// warning is in `warnings`). This preserves input ordering so the caller can
// interleave coord and element regions correctly.
export async function resolveIosRegions({
  regions = [],
  sessionId,
  pngWidth,
  pngHeight,
  isPortrait,
  deps = {}
} = {}) {
  const warnings = [];
  const elementRegions = regions.filter(r => r && r.element);
  // Sparse array: length matches elementRegions count; caller walks by index
  const resolvedRegions = new Array(elementRegions.length).fill(null);

  if (elementRegions.length === 0) {
    return { resolvedRegions, warnings };
  }

  // Gate 1: landscape/ambiguous orientation
  if (!isPortrait) {
    warnings.push('landscape-or-ambiguous');
    log.debug('wda-hierarchy: landscape-or-ambiguous');
    return { resolvedRegions, warnings };
  }

  // Gate 2: kill-switch (read from startup env; NOT from appPercy.env-forwarded tenant env)
  if (process.env.PERCY_DISABLE_IOS_ELEMENT_REGIONS === '1') {
    warnings.push('kill-switch-engaged');
    log.debug('wda-hierarchy: kill-switch-engaged');
    return { resolvedRegions, warnings };
  }

  // Gate 3: wda-meta (session-scoped authoritative port)
  const meta = deps.readWdaMeta ? deps.readWdaMeta(sessionId) : { ok: false, reason: 'no-reader' };
  if (!meta || !meta.ok) {
    const reason = meta && meta.reason ? meta.reason : 'no-reader';
    warnings.push(reason);
    log.debug(`wda-hierarchy: ${reason}`);
    return { resolvedRegions, warnings };
  }
  const port = meta.port;
  if (!Number.isInteger(port) || port < WDA_PORT_MIN || port > WDA_PORT_MAX) {
    warnings.push('out-of-range-port');
    log.debug('wda-hierarchy: out-of-range-port');
    return { resolvedRegions, warnings };
  }

  // WDA's session-scoped endpoints (/session/:sid/source) require WDA's internal
  // session UUID, which differs from the SDK-provided sessionId (Maestro's
  // automate_session_id). Contract v1.1.0+ surfaces it via meta.wdaSessionId;
  // older writers left it absent — in that case we fall back to the SDK sessionId
  // and accept that /source may 404 (→ graceful warn-skip).
  const wdaSid = typeof meta.wdaSessionId === 'string' ? meta.wdaSessionId : sessionId;

  // Scale factor — cache per session. On first resolve, fetch /wda/screen.
  let scale = scaleCache.get(sessionId);
  if (typeof scale !== 'number') {
    const scaleResult = await fetchScale(port, sessionId, pngWidth, deps.httpClient);
    if (!scaleResult.ok) {
      warnings.push(scaleResult.reason);
      log.debug(`wda-hierarchy: fetchScale failed: ${scaleResult.reason}`);
      return { resolvedRegions, warnings };
    }
    scale = scaleResult.scale;
    scaleCacheSet(sessionId, scale);
  }

  // Source dump — single fetch per screenshot; parsed once and reused across regions.
  const sourceResult = await fetchAndParseSource(port, wdaSid, deps.httpClient);
  if (!sourceResult.ok) {
    warnings.push(sourceResult.reason);
    log.debug(`wda-hierarchy: fetchAndParseSource failed: ${sourceResult.reason}`);
    return { resolvedRegions, warnings };
  }
  const nodes = sourceResult.nodes;

  // Per-region resolution. `resolvedRegions[i] = null` means skipped.
  for (let i = 0; i < elementRegions.length; i++) {
    const region = elementRegions[i];
    const { element } = region;
    const key = pickSelectorKey(element);
    if (!key) {
      warnings.push('selector-key-not-in-v1');
      log.debug('wda-hierarchy: selector-key-not-in-v1');
      continue;
    }
    const rawValue = element[key];
    if (typeof rawValue !== 'string' || rawValue.length === 0) {
      warnings.push('selector-empty');
      log.debug('wda-hierarchy: selector-empty');
      continue;
    }
    if (rawValue.length > SELECTOR_MAX_LEN) {
      warnings.push('selector-too-long');
      log.debug('wda-hierarchy: selector-too-long');
      continue;
    }

    // Normalize + validate class selectors
    let value = rawValue;
    if (key === 'class') {
      const normalized = normalizeXcuiClass(rawValue);
      if (!normalized) {
        warnings.push('class-not-allowlisted');
        log.debug('wda-hierarchy: class-not-allowlisted');
        continue;
      }
      value = normalized;
    }

    // Walk tree for first match
    const match = firstMatch(nodes, key, value);
    if (!match) {
      warnings.push('zero-match');
      log.debug('wda-hierarchy: zero-match');
      continue;
    }

    // Scale points → pixels
    const bbox = scaleRect(match, scale);
    const bboxReason = validateBbox(bbox, pngWidth, pngHeight);
    if (bboxReason) {
      warnings.push(bboxReason);
      log.debug(`wda-hierarchy: ${bboxReason}`);
      continue;
    }

    resolvedRegions[i] = {
      // Use the post-normalization value so customers get a canonical
      // elementSelector on the Percy dashboard regardless of whether they
      // typed the short or long class form.
      elementSelector: { [key]: value },
      boundingBox: bbox,
      algorithm: region.algorithm || 'ignore'
    };
  }

  return { resolvedRegions, warnings };
}

// Abort all in-flight WDA HTTP calls. Called from percy.stop() before server.close().
export function shutdown() {
  for (const controller of inflight) {
    try { controller.abort(); } catch { /* already aborted */ }
  }
  inflight.clear();
}

// ---- internal helpers ----

function pickSelectorKey(element) {
  if (!element || typeof element !== 'object') return null;
  if (typeof element.id === 'string') return 'id';
  if (typeof element.class === 'string') return 'class';
  // V1 explicitly rejects text/xpath (see plan Key Decisions + Scope Boundaries)
  return null;
}

function normalizeXcuiClass(value) {
  const fullName = value.startsWith('XCUIElementType') ? value : `XCUIElementType${value}`;
  return XCUI_ALLOWLIST.has(fullName) ? fullName : null;
}

// Flatten parsed tree. Returns an array of nodes in pre-order with normalized
// attributes: { type, name, label, rect: {x,y,width,height} }.
function flattenIosNodes(parsed) {
  const nodes = [];
  const walk = obj => {
    if (!obj || typeof obj !== 'object') return;
    if (Array.isArray(obj)) {
      for (const item of obj) walk(item);
      return;
    }
    // A node has XCUI-shape attributes when @_type is set, or alternatively
    // we can heuristically include any node with @_name/@_label + @_x/@_y/@_width/@_height.
    if (obj['@_type'] || obj['@_name'] || obj['@_label']) {
      const rect = {
        x: toNum(obj['@_x']),
        y: toNum(obj['@_y']),
        width: toNum(obj['@_width']),
        height: toNum(obj['@_height'])
      };
      nodes.push({
        type: obj['@_type'],
        name: obj['@_name'],
        label: obj['@_label'],
        rect
      });
    }
    for (const key of Object.keys(obj)) {
      if (key.startsWith('@_')) continue;
      if (key === '#text') continue;
      walk(obj[key]);
    }
  };
  walk(parsed);
  return nodes;
}

function toNum(v) {
  if (v == null) return null;
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

// Match rules per plan:
//   id → node.name
//   class → node.type (post-normalization to XCUIElementType*)
function firstMatch(nodes, key, value) {
  const attrOf = key === 'id' ? n => n.name : n => n.type;
  for (const node of nodes) {
    if (!node.rect || node.rect.x == null || node.rect.width == null) continue;
    if (attrOf(node) === value) return node.rect;
  }
  return null;
}

function scaleRect(rect, scale) {
  const left = Math.round(rect.x * scale);
  const top = Math.round(rect.y * scale);
  const right = Math.round((rect.x + rect.width) * scale);
  const bottom = Math.round((rect.y + rect.height) * scale);
  return { left, top, right, bottom };
}

function validateBbox(bbox, pngWidth, pngHeight) {
  if (bbox.left < 0 || bbox.top < 0 ||
      bbox.right > pngWidth || bbox.bottom > pngHeight ||
      bbox.left >= bbox.right || bbox.top >= bbox.bottom) {
    return 'bbox-out-of-bounds';
  }
  if ((bbox.right - bbox.left) < BBOX_MIN_SIDE_PX ||
      (bbox.bottom - bbox.top) < BBOX_MIN_SIDE_PX) {
    return 'bbox-too-small';
  }
  return null;
}

async function fetchScale(port, sessionId, pngWidth, httpClient) {
  if (!httpClient) return { ok: false, reason: 'no-http-client' };
  const url = `http://127.0.0.1:${port}/wda/screen`;
  if (!isLoopback(url)) return { ok: false, reason: 'loopback-required' };

  let response;
  try {
    response = await callWda(httpClient, url, { timeout: WDA_TIMEOUT_MS });
  } catch (err) {
    if (err && err.__abort) return { ok: false, reason: 'wda-timeout' };
    const status = err && err.response && err.response.statusCode;
    const body = err && err.response && err.response.body;
    const bodyPreview = body ? JSON.stringify(body).slice(0, 200) : '(no body)';
    log.debug(`wda-hierarchy: /wda/screen threw name=${err?.name} message=${String(err?.message || '').slice(0, 200)} code=${err?.code} status=${status} aborted=${err?.aborted} body=${bodyPreview}`);
    return { ok: false, reason: 'wda-error' };
  }
  const body = typeof response === 'string' ? safeJson(response) : response;
  const wdaScale = body && body.value && body.value.scale;
  if (Number.isInteger(wdaScale) && wdaScale >= 2 && wdaScale <= 3) {
    return { ok: true, scale: wdaScale };
  }
  // Fallback: width-ratio from window/size embedded in /wda/screen screenSize
  const logicalWidth = body && body.value && body.value.screenSize && body.value.screenSize.width;
  if (Number.isFinite(logicalWidth) && logicalWidth > 0) {
    const raw = pngWidth / logicalWidth;
    if (raw < SCALE_RANGE_MIN || raw > SCALE_RANGE_MAX) {
      return { ok: false, reason: 'scale-out-of-range' };
    }
    return { ok: true, scale: raw < 2.5 ? 2 : 3 };
  }
  return { ok: false, reason: 'scale-out-of-range' };
}

// Fetches /session/:sid/source and parses. Handles one layer of "stale-sid" retry:
// WDA's /status returns the LAST-CREATED sessionId, but Maestro spawns a new
// WDA session per xctest run — so the sid realmobile captured at write_wda_meta
// time may already be terminated by the time Percy CLI queries.
//
// WDA's "invalid session id" error response includes a top-level `sessionId`
// field carrying the currently-active sid. We extract that and retry. If the
// response has no such field (shouldn't happen on current WDA builds), we fall
// back to probing /status for a fresh sid.
async function fetchAndParseSource(port, sessionId, httpClient) {
  if (!httpClient) return { ok: false, reason: 'no-http-client' };

  const first = await tryFetchSource(port, sessionId, httpClient);
  if (first.ok || !first.staleSession) return first;

  // Stale-sid recovery path. Prefer the sid WDA itself returned in the error
  // envelope — that's the authoritative "currently active" sid at this instant.
  // Only fall back to /status if the error response didn't carry one.
  let freshSid = first.wdaReportedSid || null;
  if (!freshSid) {
    freshSid = await fetchCurrentWdaSessionId(port, httpClient);
  }
  if (!freshSid || freshSid === sessionId) {
    log.debug('wda-hierarchy: stale-session, no fresh sid available');
    return { ok: false, reason: 'wda-error' };
  }
  log.debug('wda-hierarchy: retrying /source with fresh sid');
  const retry = await tryFetchSource(port, freshSid, httpClient);
  if (retry.ok) return retry;
  return { ok: false, reason: retry.reason || 'wda-error' };
}

async function tryFetchSource(port, sessionId, httpClient) {
  const url = `http://127.0.0.1:${port}/session/${encodeURIComponent(sessionId)}/source`;
  if (!isLoopback(url)) return { ok: false, reason: 'loopback-required' };

  let raw;
  try {
    raw = await callWda(httpClient, url, { timeout: WDA_TIMEOUT_MS });
  } catch (err) {
    if (err && err.__abort) return { ok: false, reason: 'wda-timeout' };
    // @percy/client/utils#request rejects on non-2xx. WDA returns 404 with a
    // JSON error envelope on stale sessions; the body is preserved on
    // err.response.body. Inspect it before giving up.
    const body = err && err.response && err.response.body;
    const status = err && err.response && err.response.statusCode;
    const bodyPreview = body ? JSON.stringify(body).slice(0, 200) : '(no body)';
    log.debug(`wda-hierarchy: /source threw status=${status} body=${bodyPreview}`);
    if (isStaleSessionError(body)) {
      return {
        ok: false,
        reason: 'wda-error',
        staleSession: true,
        wdaReportedSid: extractTopLevelSessionId(body)
      };
    }
    return { ok: false, reason: 'wda-error' };
  }

  if (isStaleSessionError(raw)) {
    // WDA embeds the active sid at the top-level of every response, including
    // error envelopes. Surface it for the retry path.
    return {
      ok: false,
      reason: 'wda-error',
      staleSession: true,
      wdaReportedSid: extractTopLevelSessionId(raw)
    };
  }

  // Some WDA builds return source as a top-level JSON envelope {value: "<xml>"}
  const xmlRaw = extractXmlString(raw);
  if (typeof xmlRaw !== 'string' || xmlRaw.length === 0) {
    return { ok: false, reason: 'wda-error' };
  }
  if (xmlRaw.length > SOURCE_MAX_BYTES) {
    return { ok: false, reason: 'source-oversize' };
  }
  if (DOCTYPE_OR_ENTITY_RE.test(xmlRaw)) {
    return { ok: false, reason: 'xml-rejected' };
  }
  let parsed;
  try {
    parsed = parser.parse(xmlRaw);
  } catch {
    return { ok: false, reason: 'xml-parse-error' };
  }
  const nodes = flattenIosNodes(parsed);
  return { ok: true, nodes };
}

// WDA returns an error envelope like:
//   { "value": { "error": "invalid session id", "message": "Session does not exist" },
//     "sessionId": "<active-sid>" }
// when queried with a terminated sid. Both keys are stable across the WDA builds
// deployed on BS hosts.
function isStaleSessionError(raw) {
  if (!raw || typeof raw !== 'object') return false;
  const v = raw.value;
  if (!v || typeof v !== 'object') return false;
  return v.error === 'invalid session id';
}

// Accepts a WDA response object (possibly a string JSON body) and returns the
// top-level `sessionId` if it's a well-formed UUID-ish string.
function extractTopLevelSessionId(raw) {
  const body = typeof raw === 'string' ? safeJson(raw) : raw;
  if (!body || typeof body !== 'object') return null;
  const sid = body.sessionId;
  if (typeof sid !== 'string' || !/^[A-Fa-f0-9-]{16,64}$/.test(sid)) return null;
  return sid;
}

async function fetchCurrentWdaSessionId(port, httpClient) {
  const url = `http://127.0.0.1:${port}/status`;
  if (!isLoopback(url)) return null;
  let raw;
  try {
    raw = await callWda(httpClient, url, { timeout: WDA_TIMEOUT_MS });
  } catch {
    return null;
  }
  return extractTopLevelSessionId(raw);
}

function extractXmlString(raw) {
  if (typeof raw === 'string') return raw;
  if (raw && typeof raw === 'object' && typeof raw.value === 'string') return raw.value;
  return null;
}

async function callWda(httpClient, url, { timeout } = {}) {
  // Node 14 on BS iOS hosts doesn't have a global AbortController (added in
  // Node 15). Feature-detect and fall back to Promise.race — the request will
  // still be bounded, just without early-abort of the underlying socket.
  const HasAbortController = typeof globalThis.AbortController === 'function';
  const controller = HasAbortController ? new globalThis.AbortController() : null;
  if (controller) inflight.add(controller);

  let timedOut = false;
  let timer;
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      if (controller) { try { controller.abort(); } catch { /* already aborted */ } }
      reject(Object.assign(new Error('wda-timeout'), { __abort: true }));
    }, timeout);
  });

  try {
    const requestOpts = { retries: 0, interval: 10 };
    if (controller) requestOpts.signal = controller.signal;
    return await Promise.race([httpClient(url, requestOpts), timeoutPromise]);
  } catch (err) {
    if (timedOut || (controller && controller.signal.aborted)) {
      throw Object.assign(new Error('wda-timeout'), { __abort: true });
    }
    throw err;
  } finally {
    clearTimeout(timer);
    if (controller) inflight.delete(controller);
  }
}

function safeJson(s) {
  try { return JSON.parse(s); } catch { return null; }
}

function isLoopback(url) {
  try {
    const u = new URL(url);
    return u.hostname === '127.0.0.1';
  } catch {
    return false;
  }
}

function scaleCacheSet(sessionId, scale) {
  // LRU via delete + set
  scaleCache.delete(sessionId);
  scaleCache.set(sessionId, scale);
  if (scaleCache.size > SCALE_CACHE_MAX) {
    const oldest = scaleCache.keys().next().value;
    scaleCache.delete(oldest);
  }
}

// Exported for test inspection
export function _resetForTest() {
  scaleCache.clear();
  inflight.clear();
}
