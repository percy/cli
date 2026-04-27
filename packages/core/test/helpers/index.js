import { resetPercyConfig, mockfs as mfs, fs } from '@percy/config/test/helpers';
import logger from '@percy/logger/test/helpers';
import api from '@percy/client/test/helpers';
import path from 'path';
import url from 'url';

export function mockfs(initial) {
  return mfs({
    ...initial,

    $bypass: [
      path.resolve(url.fileURLToPath(import.meta.url), '/../../../dom/dist/bundle.js'),
      path.resolve(url.fileURLToPath(import.meta.url), '../secretPatterns.yml'),
      p => p.includes?.('.local-chromium'),
      // PER-7855 Phase 2: per-port lockfiles live under ~/.percy/. They
      // are infrastructure (not test fixture data), so route them through
      // the real fs. Tests on a developer machine may briefly see lock
      // files appear under ~/.percy/ during a run; they are cleaned up in
      // Percy.stop() and are guarded against same-process collision by
      // the self-pid stale optimization in lock.js.
      p => typeof p === 'string' && p.includes('/.percy/agent-'),
      ...(initial?.$bypass ?? [])
    ]
  });
}

export async function setupTest({
  resetConfig,
  filesystem,
  loggerTTY,
  apiDelay
} = {}) {
  await api.mock({ delay: apiDelay });
  await logger.mock({ isTTY: loggerTTY });
  await resetPercyConfig(resetConfig);
  await mockfs(filesystem);
}

export * from '@percy/client/test/helpers';
export { createTestServer } from './server.js';
export { dedent } from './dedent.js';
export { logger, fs };
