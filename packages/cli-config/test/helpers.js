// required before fs is mocked by the config helper
require('@oclif/command');

// `export from` is hoisted, so just use require
const { default: mockConfig, getMockConfig } = require('@percy/config/test/helper');
const { default: stdio } = require('@percy/logger/test/helper');

export { stdio, mockConfig, getMockConfig };
