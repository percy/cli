import { stripQuotesAndSpaces } from '@percy/env/utils';

describe('stripQuotesAndSpaces', () => {
  it('should remove leading and trailing spaces', () => {
    const line = '  this is a line with spaces  ';
    const expected = 'this is a line with spaces';
    const actual = stripQuotesAndSpaces(line);
    expect(actual).toBe(expected);
  });

  it('should remove leading and trailing double quotes', () => {
    const line = '"this is a line with double quotes"';
    const expected = 'this is a line with double quotes';
    const actual = stripQuotesAndSpaces(line);
    expect(actual).toBe(expected);
  });

  it('should remove both leading and trailing spaces and double quotes', () => {
    const line = '" this is a line with spaces and double quotes  "';
    const expected = 'this is a line with spaces and double quotes';
    const actual = stripQuotesAndSpaces(line);
    expect(actual).toBe(expected);
  });

  it('should return null if line is null', () => {
    const line = null;
    const expected = null;
    const actual = stripQuotesAndSpaces(line);
    expect(actual).toBe(expected);
  });
});
