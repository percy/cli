// Constants and helpers shared across all Percy JS SDKs for cross-origin
// iframe handling. Imported via `@percy/sdk-utils` so each SDK doesn't
// re-declare the same lists and clamping logic.

export const UNSUPPORTED_IFRAME_SRCS = [
  'about:blank',
  'about:srcdoc',
  'javascript:',
  'data:',
  'blob:',
  'vbscript:',
  'chrome:',
  'chrome-extension:'
];

export const DEFAULT_MAX_FRAME_DEPTH = 10;
export const HARD_MAX_FRAME_DEPTH = 25;

export function isUnsupportedIframeSrc(src) {
  if (!src) return true;
  const lower = String(src).toLowerCase();
  return UNSUPPORTED_IFRAME_SRCS.some(prefix => lower === prefix || lower.startsWith(prefix));
}

export function clampFrameDepth(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return DEFAULT_MAX_FRAME_DEPTH;
  return Math.min(n, HARD_MAX_FRAME_DEPTH);
}

export function normalizeIgnoreSelectors(list) {
  return Array.isArray(list) ? list.filter(s => typeof s === 'string' && s.trim()) : [];
}

export function resolveMaxFrameDepth(options = {}) {
  return clampFrameDepth(options.maxIframeDepth ?? DEFAULT_MAX_FRAME_DEPTH);
}

export function resolveIgnoreSelectors(options = {}) {
  return normalizeIgnoreSelectors(options.ignoreIframeSelectors ?? []);
}
