// Iframe depth constants shared with @percy/dom's serialize-frames. Kept
// here so external Percy SDKs (Capybara, Cypress, Playwright, etc.) can
// clamp their own pre-CLI configuration to the same bounds the CLI enforces.
// The two modules MUST stay in sync — see packages/dom/src/serialize-frames.js
// for the matching DEFAULT_MAX_IFRAME_DEPTH / HARD_MAX_IFRAME_DEPTH constants.

export const DEFAULT_MAX_IFRAME_DEPTH = 3;
export const HARD_MAX_IFRAME_DEPTH = 10;

export function clampIframeDepth(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return DEFAULT_MAX_IFRAME_DEPTH;
  return Math.min(Math.floor(n), HARD_MAX_IFRAME_DEPTH);
}
