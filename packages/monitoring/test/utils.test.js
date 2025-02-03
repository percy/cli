import { promises as fs } from 'fs';
import { pathsExist } from '../src/utils.js';

describe('pathsExist', () => {
  let path1 = '/test_dir/a.txt';
  let path2 = '/test_dir1/b.txt';
  let paths = [path1, path2];

  beforeEach(() => {
    spyOn(fs, 'access').and.callFake((path) => {
      if (path === path1) return Promise.resolve();
      if (path === path2) return Promise.resolve();
      return Promise.reject(new Error('some_error'));
    });
  });

  it('returns true when path exists', async () => {
    expect(await pathsExist(paths)).toEqual(true);
  });

  it('returns false when path not exists', async () => {
    expect(await pathsExist(['/test_dir2/c.txt'])).toEqual(false);
  });
});
