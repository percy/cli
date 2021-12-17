import { logger, mockAPI } from '@percy/core/test/helpers';

beforeEach(() => {
  process.env.PERCY_TOKEN = '<<PERCY_TOKEN>>';
});

afterEach(() => {
  delete process.env.PERCY_TOKEN;
  delete process.env.PERCY_ENABLE;
  delete process.env.PERCY_PARALLEL_TOTAL;
  delete process.env.PERCY_PARTIAL_BUILD;
});

export { logger, mockAPI };
export { createTestServer } from '@percy/core/test/helpers/server';
