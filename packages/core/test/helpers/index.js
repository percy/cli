import os from 'os';
import path from 'path';
import rimraf from 'rimraf';
import log from '@percy/logger';
import mockAPI from '@percy/client/test/helper';

beforeEach(() => {
  mockAPI.start();
  // set the default log level for testing
  log.loglevel('error');
});

afterEach(() => {
  // cleanup tmp files
  rimraf.sync(path.join(os.tmpdir(), 'percy'));
});

export { mockAPI };
export { default as stdio } from '@percy/logger/test/helper';
export { default as createTestServer } from './test-server';
export { default as dedent } from './dedent';
