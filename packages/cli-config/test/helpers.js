import fs from 'fs';
import mock from 'mock-require';
export { default as stdio } from '@percy/logger/test/helper';

const configs = new Map();
const writes = new Map();

export function mockConfig(f, c) {
  configs.set(f, {
    get config() { return typeof c === 'function' ? c() : c; },
    filepath: f
  });
}

export function getWrite(f) {
  return writes.get(f);
}

// mocked modules need to be mocked before any dependent imports, so they're not
// included inside of a test hook here

// mock cosmiconfig for reading configs
mock('cosmiconfig', {
  cosmiconfigSync: () => ({
    load: f => configs.get(f),
    search: () => configs.values().next().value
  })
});

// required before fs is mocked so it can use unmocked fs
require('@oclif/command');

// mock fs for writing configs
mock('fs', {
  ...fs,
  writeFileSync: (f, c) => writes.set(f, c),
  existsSync: f => writes.has(f)
});

after(() => {
  mock.stopAll();
});

afterEach(() => {
  configs.clear();
  writes.clear();
});
