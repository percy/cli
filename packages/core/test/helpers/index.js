import os from 'os';
import path from 'path';
import rimraf from 'rimraf';
import logger from '@percy/logger/test/helper';
import mockAPI from '@percy/client/test/helper';

beforeEach(() => {
  // mock logging
  logger.mock();
  // mock API
  mockAPI.start();
});

afterEach(done => {
  // cleanup tmp files
  rimraf(path.join(os.tmpdir(), 'percy'), () => done());
});

export { logger, mockAPI };
export { default as createTestServer } from './server';
export { default as dedent } from './dedent';
