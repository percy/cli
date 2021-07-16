import mock from 'mock-require';

describe('dotenv files', () => {
  let env, dotenvs;

  beforeAll(() => {
    env = process.env;
    mock('fs', { readFileSync: path => dotenvs[path] ?? '' });
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

  it('does not override existing environment variables', () => {
    process.env.TEST_1 = 'uno';
    mock.reRequire('../src');

    expect(process.env).toHaveProperty('TEST_1', 'uno');
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

  it('expands newlines within double quotes', () => {
    dotenvs['.env'] = 'TEST_NEWLINES="foo\nbar\r\nbaz\\nqux\\r\\nxyzzy"';
    mock.reRequire('../src');

    expect(process.env).toHaveProperty('TEST_NEWLINES', 'foo\nbar\r\nbaz\nqux\r\nxyzzy');
  });

  it('interpolates variable substitutions', () => {
    // eslint-disable-next-line no-template-curly-in-string
    dotenvs['.env'] += '\nTEST_4=$TEST_1${TEST_2}\nTEST_5=$TEST_4${TEST_3}four';
    mock.reRequire('../src');

    expect(process.env).toHaveProperty('TEST_4', '1two');
    expect(process.env).toHaveProperty('TEST_5', '1two3four');
  });

  it('interpolates undefined variables with empty strings', () => {
    // eslint-disable-next-line no-template-curly-in-string
    dotenvs['.env'] += '\nTEST_TWO=2 > ${TEST_ONE}\nTEST_THREE=';
    mock.reRequire('../src');

    expect(process.env).not.toHaveProperty('TEST_ONE');
    expect(process.env).toHaveProperty('TEST_TWO', '2 > ');
    expect(process.env).toHaveProperty('TEST_THREE', '');
  });

  it('does not interpolate single quoted strings', () => {
    dotenvs['.env'] += "\nTEST_STRING='$TEST_1'";
    mock.reRequire('../src');

    expect(process.env).toHaveProperty('TEST_STRING', '$TEST_1');
  });

  it('does not interpolate escaped dollar signs', () => {
    dotenvs['.env'] += '\nTEST_ESC=\\$TEST_1';
    mock.reRequire('../src');

    expect(process.env).toHaveProperty('TEST_ESC', '$TEST_1');
  });
});
