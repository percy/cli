import { migration } from '../../src/config';

describe('unit / config', () => {
  let mocked = {
    map: (...a) => mocked.migrate.map.push(a),
    del: (...a) => mocked.migrate.del.push(a)
  };

  beforeEach(() => {
    mocked.migrate = { map: [], del: [] };
  });

  it('migrates v1 config', () => {
    migration({
      version: 1,
      staticSnapshots: {
        baseUrl: 'base-url',
        snapshotFiles: '*.html',
        ignoreFiles: '*.htm'
      }
    }, mocked);

    expect(mocked.migrate.map).toEqual([
      ['staticSnapshots.baseUrl', 'static.baseUrl'],
      ['staticSnapshots.snapshotFiles', 'static.files'],
      ['staticSnapshots.ignoreFiles', 'static.ignore']
    ]);

    expect(mocked.migrate.del).toEqual([
      ['staticSnapshots']
    ]);
  });

  it('does not migrate when not needed', () => {
    migration({
      version: 2,
      static: {
        baseUrl: 'base-url',
        files: '*.html',
        ignore: '*.htm'
      }
    }, mocked);

    expect(mocked.migrate.map).toEqual([]);
    expect(mocked.migrate.del).toEqual([]);
  });
});
