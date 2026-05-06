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
import {
  DEFAULT_MAX_IFRAME_DEPTH,
  HARD_MAX_IFRAME_DEPTH,
  clampIframeDepth
} from './iframe-utils.js';

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
  clampIframeDepth
};

// export the namespace by default
export * as default from './index.js';
