import nock from 'nock';
import mock from 'mock-require';
import initCommon from '@percy/cli-command/dist/hooks/init';
import mockAPI from '@percy/client/test/helper';

before(() => {
  initCommon();
});

beforeEach(() => {
  process.env.PERCY_TOKEN = '<<PERCY_TOKEN>>';
  mockAPI.start();
});

afterEach(() => {
  delete process.env.PERCY_TOKEN;
  delete process.env.PERCY_ENABLE;
  process.removeAllListeners();
  nock.cleanAll();
  mock.stopAll();
});

export { mockAPI };
export { default as stdio } from '@percy/logger/test/helper';
