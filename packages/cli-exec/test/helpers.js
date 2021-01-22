import logger from '@percy/logger/test/helper';
import mockAPI from '@percy/client/test/helper';

beforeEach(() => {
  process.env.PERCY_TOKEN = '<<PERCY_TOKEN>>';
  mockAPI.start();
  logger.mock();
});

afterEach(() => {
  delete process.env.PERCY_TOKEN;
  delete process.env.PERCY_ENABLE;
  delete process.env.PERCY_PARALLEL_TOTAL;
  process.removeAllListeners();
});

export { logger, mockAPI };
export { default as createTestServer } from '@percy/core/test/helpers/server';
