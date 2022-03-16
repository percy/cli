import logger from '@percy/logger';
import percy from './percy-info';
import request from './request';
import isPercyEnabled from './percy-enabled';
import fetchPercyDOM from './percy-dom';
import postSnapshot from './post-snapshot';

// export the namespace by default
export * as default from '.';

export {
  logger,
  percy,
  request,
  isPercyEnabled,
  fetchPercyDOM,
  postSnapshot
};
