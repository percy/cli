import { tagsList } from '@percy/env/utils';

describe('tagsList', () => {
  it('should return empty array when tags is undefined', () => {
    let tags;
    const actual = tagsList(tags);
    expect(actual).toEqual([]);
  });

  it('should return empty array when tags is null', () => {
    let tags = null;
    const actual = tagsList(tags);
    expect(actual).toEqual([]);
  });

  it('should return empty array when tags is not string', () => {
    let tags = 123;
    const actual = tagsList(tags);
    expect(actual).toEqual([]);
  });

  it('should return array of tag objects when tags-names are passed', () => {
    let tags = 'tag1,tag2,tag3';
    const expected = [
      { id: null, name: 'tag1' },
      { id: null, name: 'tag2' },
      { id: null, name: 'tag3' }
    ];
    const actual = tagsList(tags);
    expect(actual).toEqual(expected);
  });
});
