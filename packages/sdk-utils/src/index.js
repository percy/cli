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
import exposeClosedShadowRoots, { walkCDPNodes } from './closed-shadow.js';

// Iframe depth constants shared with @percy/dom's serialize-frames. Kept
// here so external Percy SDKs (Capybara, Cypress, Playwright, etc.) can
// clamp their own pre-CLI configuration to the same bounds the CLI enforces.
const DEFAULT_MAX_IFRAME_DEPTH = 3;
const HARD_MAX_IFRAME_DEPTH = 10;

function clampIframeDepth(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return DEFAULT_MAX_IFRAME_DEPTH;
  return Math.min(Math.floor(n), HARD_MAX_IFRAME_DEPTH);
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
  DEFAULT_MAX_IFRAME_DEPTH,
  HARD_MAX_IFRAME_DEPTH,
  clampIframeDepth,
  exposeClosedShadowRoots,
  walkCDPNodes
};

// export the namespace by default
export * as default from './index.js';
