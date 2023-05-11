import logger from './logger.js';
import percy from './percy-info.js';
import request from './request.js';
import isPercyEnabled from './percy-enabled.js';
import waitForPercyIdle from './percy-idle.js';
import fetchPercyDOM from './percy-dom.js';
import postSnapshot from './post-snapshot.js';
import postComparison from './post-comparison.js';
import flushSnapshots from './flush-snapshots.js';
import postScreenshot from './post-screenshot.js';

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
  postScreenshot
};

// export the namespace by default
export * as default from './index.js';
