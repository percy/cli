import fs from 'fs';
import mock from 'mock-require';

export { default as stdio } from '@percy/logger/test/helper';
export { default as mockConfig } from '@percy/config/test/helper';

const writes = new Map();

export function getWrite(f) {
  return writes.get(f);
}

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
  writes.clear();
});
