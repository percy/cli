import mock from 'mock-require';

describe('dotenv files', () => {
  let env, dotenvs;

  beforeAll(() => {
    env = process.env;
    mock('fs', { readFileSync: path => dotenvs[path] ?? '' });
    mock.reRequire('dotenv');
    mock.reRequire('../src/dotenv');
  });

  afterAll(() => {
    process.env = env;
    mock.stop('fs');
  });

  beforeEach(() => {
    dotenvs = {};
    dotenvs['.env'] = 'TEST_1=1\nTEST_2=2\nTEST_3=3';
    dotenvs['.env.local'] = 'TEST_2=two';
    process.env = {};
  });

  it('loads .env and .env.local files', () => {
    mock.reRequire('../src');

    expect(process.env).toHaveProperty('TEST_1', '1');
    expect(process.env).toHaveProperty('TEST_2', 'two');
    expect(process.env).toHaveProperty('TEST_3', '3');
  });

  it('loads environment specific .env and .env.local files', () => {
    dotenvs['.env.dev'] = 'TEST_3=dev_3';
    dotenvs['.env.dev.local'] = 'TEST_2=dev_two';
    process.env.NODE_ENV = 'dev';
    mock.reRequire('../src');

    expect(process.env).toHaveProperty('TEST_1', '1');
    expect(process.env).toHaveProperty('TEST_2', 'dev_two');
    expect(process.env).toHaveProperty('TEST_3', 'dev_3');
  });

  it('does not load .env.local when NODE_ENV is "test"', () => {
    dotenvs['.env.test'] = 'TEST_3=test_3';
    process.env.NODE_ENV = 'test';
    mock.reRequire('../src');

    expect(process.env).toHaveProperty('TEST_1', '1');
    expect(process.env).toHaveProperty('TEST_2', '2');
    expect(process.env).toHaveProperty('TEST_3', 'test_3');
  });

  it('does not load any files when PERCY_DISABLE_DOTENV is set', () => {
    process.env.PERCY_DISABLE_DOTENV = 'true';
    mock.reRequire('../src');
    expect(process.env).toEqual({ PERCY_DISABLE_DOTENV: 'true' });
  });
});
