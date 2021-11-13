import path from 'path';
import mock from 'mock-require';

export const configs = new Map();

export function mockConfig(f, c) {
  configs.set(f, () => typeof c === 'function' ? c() : c);
}

export function getMockConfig(f) {
  return configs.get(f)?.();
}

function rel(filepath) {
  return path.relative('', filepath);
}

// required before mocking fs so functionality is unaffected
require('@percy/logger');

mock('fs', Object.assign({}, require('fs'), {
  readFileSync: f => getMockConfig(rel(f)) || null,
  existsSync: f => configs.has(rel(f)),
  statSync: f => ({
    // rudimentary check for tests - not a config and is not a dotfile
    isDirectory: () => !configs.has(rel(f)) &&
      !path.extname(f) && !path.basename(f).includes('.')
  }),
  // support tests for writing configs
  writeFileSync: (f, c) => mockConfig(rel(f), c),
  renameSync: (f, t) => {
    f = rel(f);
    let conf = configs.get(f);
    if (configs.delete(f)) configs.set(rel(t), conf);
  }
}));

// re-required so future imports are not cached
mock.reRequire('fs');

afterAll(() => {
  mock.stopAll();
});

afterEach(() => {
  configs.clear();
});

export default mockConfig;
