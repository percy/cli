// @percy/logger/internal
//
// Non-public surface used by @percy/core. Lives behind a dedicated
// subexport so the default export (`@percy/logger`) stays minimal and
// SDK consumers can't accidentally depend on implementation details that
// may change without a major version bump. See DPR-11 in the plan.

import logger from './index.js';
export { snapshotKey } from './internal-utils.js';

export function evictSnapshot (key) {
  logger.instance.evictSnapshot(key);
}

export function readBack () {
  return logger.instance.readBack();
}
