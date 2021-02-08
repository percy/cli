import expect from 'expect';
import { pluginMocker, mockRequire } from './helpers';

describe('Plugin auto-registration', () => {
  let mock, run;

  beforeEach(() => {
    mock = pluginMocker();
    mockRequire('@oclif/command', { run() {} });
    run = mockRequire.reRequire('..').run;
  });

  afterEach(() => {
    mockRequire.stopAll();
  });

  it('adds unregistered plugins to the package.json', async () => {
    mock({
      plugins: {
        '@percy/cli-exec': true
      },
      packages: {
        '@percy/cli-config': true,
        '@percy/cli-exec': true,
        '@percy/core': false,
        '@percy/storybook': true,
        'percy-cli-custom': true,
        'percy-cli-no': false,
        'percy-custom': true
      }
    });

    await run();

    expect(mock.pkg.oclif.plugins).toEqual([
      '@percy/cli-exec',
      '@percy/cli-config',
      '@percy/storybook',
      'percy-cli-custom'
    ]);
  });

  it('removes missing plugins from the package.json', async () => {
    mock({
      plugins: {
        '@percy/cli-exec': true,
        '@percy/cli-other': false
      },
      packages: {
        '@percy/cli-exec': true
      }
    });

    await run();

    expect(mock.pkg.oclif.plugins).toEqual([
      '@percy/cli-exec'
    ]);
  });

  it('does nothing when plugins are registered', async () => {
    mock({
      plugins: {
        '@percy/cli-exec': true,
        '@percy/cli-other': true
      },
      packages: {
        '@percy/cli-exec': true,
        '@percy/cli-other': true
      }
    });

    await run();

    expect(mock.pkg.oclif.plugins).toEqual([
      '@percy/cli-exec',
      '@percy/cli-other'
    ]);
  });
});
