import logger from './logger.js';
import percy from './percy-info.js';
import request from './request.js';
import isPercyEnabled from './percy-enabled.js';
import waitForPercyIdle from './percy-idle.js';
import fetchPercyDOM from './percy-dom.js';
import postSnapshot from './post-snapshot.js';
import postComparison from './post-comparison.js';
import postBuildEvents from './post-build-event.js';
import flushSnapshots from './flush-snapshots.js';
import captureAutomateScreenshot from './post-screenshot.js';
import getResponsiveWidths from './get-responsive-widths.js';
import mergeSnapshotOptions from './merge-snapshot-options.js';
import {
  waitForReadyScript,
  getReadinessConfig,
  isReadinessDisabled,
  runReadinessGate
} from './serialize-dom.js';

// Iframe depth constants shared with @percy/dom's serialize-frames. Kept
// here so external Percy SDKs (Capybara, Cypress, Playwright, etc.) can
// clamp their own pre-CLI configuration to the same bounds the CLI enforces.
//
// MIRROR: must match @percy/dom/src/serialize-frames.js. The pair is kept
// duplicated (rather than imported across the package boundary) because the
// previous cross-package import broke Node 14 CI; the parity test below
// enforces alignment instead. Don't change one without changing the other.
const DEFAULT_MAX_IFRAME_DEPTH = 3;
const HARD_MAX_IFRAME_DEPTH = 10;

function clampIframeDepth(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return DEFAULT_MAX_IFRAME_DEPTH;
  return Math.min(Math.floor(n), HARD_MAX_IFRAME_DEPTH);
}

// Canonical list of iframe `src` URL prefixes that out-of-process SDK frame
// walks (Capybara, Nightwatch, Playwright, Puppeteer, Selenium, ...) must NOT
// switch into / serialize: browser-internal pages, non-HTTP schemes, and
// pseudo-protocols that either can't be navigated cross-process or are unsafe
// to recurse into. SINGLE SOURCE OF TRUTH — every SDK previously hand-copied
// this list (it drifted into 4 divergent versions), so they now consume it
// from here instead. `startsWith`, case-insensitive.
const UNSUPPORTED_IFRAME_SRCS = [
  'about:', 'chrome:', 'chrome-extension:', 'devtools:', 'edge:',
  'opera:', 'view-source:', 'data:', 'javascript:', 'blob:',
  'vbscript:', 'file:', 'ws:', 'wss:', 'ftp:'
];

// True when an iframe `src` should be skipped by an SDK frame walk. A missing
// / empty src is treated as unsupported (nothing to navigate to).
function isUnsupportedIframeSrc(src) {
  if (!src) return true;
  const s = String(src).toLowerCase();
  return UNSUPPORTED_IFRAME_SRCS.some(prefix => s.startsWith(prefix));
}

// Normalize a raw ignore-selectors value (array | string | unset) into a
// clean string[]. PercyDOM does `selectors?.length && selectors.some(...)`,
// which throws when handed a bare string (has .length, no .some), so SDKs
// must normalize before forwarding — this is the shared primitive.
function normalizeIgnoreSelectors(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.filter(s => typeof s === 'string' && s.length);
  if (typeof value === 'string') return [value];
  return [];
}

// Resolve the effective maxIframeDepth for a snapshot: per-snapshot option
// wins over the global `percy.config.snapshot.maxIframeDepth`, then the value
// is clamped to [1, HARD_MAX_IFRAME_DEPTH] (invalid/<1 -> default).
function resolveMaxFrameDepth(options = {}) {
  let raw = options.maxIframeDepth;
  if (raw == null) raw = percy?.config?.snapshot?.maxIframeDepth;
  return clampIframeDepth(raw);
}

// Resolve the effective ignoreIframeSelectors for a snapshot: per-snapshot
// option wins; when absent, fall back to the global
// `percy.config.snapshot.ignoreIframeSelectors`. Always returns a string[].
function resolveIgnoreSelectors(options = {}) {
  const perSnapshot = normalizeIgnoreSelectors(
    options.ignoreIframeSelectors ?? options.ignoreSelectors);
  if (perSnapshot.length) return perSnapshot;
  return normalizeIgnoreSelectors(percy?.config?.snapshot?.ignoreIframeSelectors);
}

export {
  logger,
  percy,
  request,
  isPercyEnabled,
  waitForPercyIdle,
  fetchPercyDOM,
  postSnapshot,
  postComparison,
  flushSnapshots,
  captureAutomateScreenshot,
  postBuildEvents,
  getResponsiveWidths,
  mergeSnapshotOptions,
  DEFAULT_MAX_IFRAME_DEPTH,
  HARD_MAX_IFRAME_DEPTH,
  clampIframeDepth,
  UNSUPPORTED_IFRAME_SRCS,
  isUnsupportedIframeSrc,
  normalizeIgnoreSelectors,
  resolveMaxFrameDepth,
  resolveIgnoreSelectors,
  waitForReadyScript,
  getReadinessConfig,
  isReadinessDisabled,
  runReadinessGate
};

// export the namespace by default
export * as default from './index.js';
