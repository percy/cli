import mock from 'mock-require';

const configs = new Map();

export default function mockConfig(f, c) {
  configs.set(f, {
    filepath: f,
    get config() {
      return typeof c === 'function' ? c() : c;
    }
  });
}

// mock cosmiconfig for reading configs
mock('cosmiconfig', {
  cosmiconfigSync: () => ({
    load: f => ({ ...configs.get(f) }),
    search: () => configs.values().next().value
  })
});

after(() => {
  mock.stopAll();
});

afterEach(() => {
  configs.clear();
});
