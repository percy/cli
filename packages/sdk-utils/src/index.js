import logger from '@percy/logger';
import percy from './percy-info.js';
import request from './request.js';
import isPercyEnabled from './percy-enabled.js';
import waitForPercyIdle from './percy-idle.js';
import fetchPercyDOM from './percy-dom.js';
import postSnapshot from './post-snapshot.js';

export {
  logger,
  percy,
  request,
  isPercyEnabled,
  waitForPercyIdle,
  fetchPercyDOM,
  postSnapshot
};

// export the namespace by default
export * as default from './index.js';
