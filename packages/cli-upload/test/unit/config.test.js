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
      imageSnapshots: {
        path: '~/pathname/',
        files: '*.png',
        ignore: '*.jpg'
      }
    }, mocked);

    expect(mocked.migrate.map).toEqual([
      ['imageSnapshots.files', 'upload.files'],
      ['imageSnapshots.ignore', 'upload.ignore']
    ]);

    expect(mocked.migrate.del).toEqual([
      ['imageSnapshots']
    ]);
  });

  it('does not migrate when not needed', () => {
    migration({
      version: 2,
      upload: {
        files: '*.png',
        ignore: '*.jpg'
      }
    }, mocked);

    expect(mocked.migrate.map).toEqual([]);
    expect(mocked.migrate.del).toEqual([]);
  });
});
