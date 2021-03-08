import { migration } from '../../src/config';

describe('unit / config', () => {
  let migrate;
  let set = (key, value) => (migrate[key] = value);

  beforeEach(() => {
    migrate = {};
  });

  it('migrates v1 config', () => {
    migration({
      version: 1,
      staticSnapshots: {
        baseUrl: 'base-url',
        snapshotFiles: '*.html',
        ignoreFiles: '*.htm'
      }
    }, set);

    expect(migrate).toEqual({
      'static.baseUrl': 'base-url',
      'static.files': '*.html',
      'static.ignore': '*.htm'
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
      static: {
        baseUrl: 'base-url',
        files: '*.html',
        ignore: '*.htm'
      }
    }, set);

    expect(migrate).toEqual({});
  });
});
