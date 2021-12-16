// required before fs is mocked by the config helper
import logger from '@percy/logger/test/helpers';

beforeEach(() => {
  logger.mock();
});

export { logger };
export { mockConfig, getMockConfig } from '@percy/config/test/helpers';
