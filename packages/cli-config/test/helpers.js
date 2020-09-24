// required before fs is mocked by the config helper
import '@oclif/command';
export { default as stdio } from '@percy/logger/test/helper';
export { default as mockConfig, getMockConfig } from '@percy/config/test/helper';
