import os from 'os';
import path from 'path';
import rimraf from 'rimraf';
import logger from '@percy/logger/test/helpers';
import mockAPI from '@percy/client/test/helpers';

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
export { createTestServer } from './server';
export { dedent } from './dedent';
