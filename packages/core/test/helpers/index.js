import { resetPercyConfig, mockfs as mfs, fs } from '@percy/config/test/helpers';
import logger from '@percy/logger/test/helpers';
import api from '@percy/client/test/helpers';

export function mockfs(initial) {
  return mfs({
    ...initial,

    $bypass: [
      require.resolve('@percy/dom'),
      require.resolve('../../../core/package.json'),
      require.resolve('../../../client/package.json'),
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
  await logger.mock({ isTTY: loggerTTY });
  await api.mock({ delay: apiDelay });
  resetPercyConfig(resetConfig);
  mockfs(filesystem);
}

export { createTestServer } from './server';
export { dedent } from './dedent';
export { logger, api, fs };
