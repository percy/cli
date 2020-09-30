import mockAPI from '@percy/client/test/helper';

beforeEach(() => {
  process.env.PERCY_TOKEN = '<<PERCY_TOKEN>>';
  mockAPI.start();
});

afterEach(() => {
  delete process.env.PERCY_TOKEN;
  delete process.env.PERCY_ENABLE;
  delete process.env.PERCY_PARALLEL_TOTAL;
  process.removeAllListeners();
});

export { mockAPI };
export { default as stdio } from '@percy/logger/test/helper';
export { default as createTestServer } from '@percy/core/test/helpers/server';
