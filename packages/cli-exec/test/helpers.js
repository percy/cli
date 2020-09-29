import nock from 'nock';
import mock from 'mock-require';
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
  nock.cleanAll();
  mock.stopAll();
});

export { mockAPI };
export { default as stdio } from '@percy/logger/test/helper';
