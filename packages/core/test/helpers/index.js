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
  // Why: downstream packages (cli-exec, cli-snapshot, percy core, etc.) use
  // mockfs as their default fs sandbox, and the disk-backed logger flakes
  // ENOENT against mockfs's volume mid-flush — which leaks the fallback
  // warning into another test's captured stderr. Keep these tests in
  // unbounded in-memory mode (master parity) — the disk path has its own
  // dedicated coverage in logger.test.js.
  process.env.PERCY_LOGS_IN_MEMORY = '1';
  await api.mock({ delay: apiDelay });
  await logger.mock({ isTTY: loggerTTY });
  await resetPercyConfig(resetConfig);
  await mockfs(filesystem);
}

export * from '@percy/client/test/helpers';
export { createTestServer } from './server.js';
export { dedent } from './dedent.js';
export { logger, fs };
