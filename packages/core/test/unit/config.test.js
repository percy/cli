import { migration } from '../../src/config';

describe('Unit / Config', () => {
  let migrate;
  let set = (key, value) => (migrate[key] = value);

  beforeEach(() => {
    migrate = {};
  });

  it('migrates v1 config', () => {
    migration({
      version: 1,
      snapshot: {
        widths: [1000]
      },
      agent: {
        assetDiscovery: {
          requestHeaders: { foo: 'bar' },
          allowedHostnames: ['allowed'],
          networkIdleTimeout: 150,
          pagePoolSizeMin: 1,
          pagePoolSizeMax: 5,
          cacheResponses: false
        }
      }
    }, set);

    expect(migrate).toEqual({
      snapshot: { widths: [1000] },
      'snapshot.requestHeaders': { foo: 'bar' },
      'discovery.allowedHostnames': ['allowed'],
      'discovery.networkIdleTimeout': 150,
      'discovery.concurrency': 5,
      'discovery.disableCache': true
    });
  });

  it('only migrates own config options', () => {
    migration({
      version: 1,
      otherOptions: {
        baseUrl: 'base-url',
        snapshotFiles: '*.html',
        ignoreFiles: '*.htm'
      }
    }, set);

    expect(migrate).toEqual({});
  });

  it('does not migrate when not needed', () => {
    migration({
      version: 2,
      discovery: {
        allowedHostnames: ['allowed']
      }
    }, set);

    expect(migrate).toEqual({});
  });
});
