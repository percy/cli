import expect from 'expect';
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
      imageSnapshots: {
        path: '~/pathname/',
        files: '*.png',
        ignore: '*.jpg'
      }
    }, set);

    expect(migrate).toEqual({
      'upload.files': '*.png',
      'upload.ignore': '*.jpg'
    });
  });

  it('only migrates own config options', () => {
    migration({
      version: 1,
      otherOptions: {
        path: '~/pathname/',
        files: '*.png',
        ignore: '*.jpg'
      }
    }, set);

    expect(migrate).toEqual({});
  });

  it('does not migrate when not needed', () => {
    migration({
      version: 2,
      upload: {
        files: '*.png',
        ignore: '*.jpg'
      }
    }, set);

    expect(migrate).toEqual({});
  });
});
