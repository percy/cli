import { configMigration } from '../../src/config.js';

describe('Unit / Config Migration', () => {
  let mocked = {
    deprecate: (...a) => mocked.migrate.deprecate.push(a),
    map: (...a) => mocked.migrate.map.push(a),
    del: (...a) => mocked.migrate.del.push(a)
  };

  beforeEach(() => {
    mocked.migrate = { deprecate: [], map: [], del: [] };
  });

  it('migrates v1 config', () => {
    configMigration({
      version: 1,
      staticSnapshots: {
        baseUrl: 'base-url',
        snapshotFiles: '*.html',
        ignoreFiles: '*.htm'
      }
    }, mocked);

    expect(mocked.migrate.map).toEqual([
      ['staticSnapshots.baseUrl', 'static.baseUrl'],
      ['staticSnapshots.snapshotFiles', 'static.include'],
      ['staticSnapshots.ignoreFiles', 'static.exclude']
    ]);

    expect(mocked.migrate.del).toEqual([
      ['staticSnapshots']
    ]);
  });

  it('does not migrate when not needed', () => {
    configMigration({
      version: 2,
      static: {
        baseUrl: 'base-url',
        include: '*.html',
        exclude: '*.htm'
      }
    }, mocked);

    expect(mocked.migrate.map).toEqual([]);
    expect(mocked.migrate.del).toEqual([]);
  });
});
