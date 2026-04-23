// Non-public surface used by @percy/core. Kept behind this subexport so
// SDK consumers cannot accidentally depend on implementation details.

import logger from './index.js';

export { snapshotKey } from './hybrid-log-store.js';

export function evictSnapshot(key) {
  logger.instance.evictSnapshot(key);
}

export function readBack() {
  return logger.instance.readBack();
}
