import { resolvePages } from '../src/pages.js';

describe('@percy/cli-pdf page selection', () => {
  it('selects every page when nothing is specified', () => {
    expect(resolvePages({}, 4)).toEqual([1, 2, 3, 4]);
    expect(resolvePages(undefined, 2)).toEqual([1, 2]);
  });

  it('accepts a single page number', () => {
    expect(resolvePages({ pages: 3 }, 5)).toEqual([3]);
  });

  it('accepts an array of pages, sorted and de-duplicated', () => {
    expect(resolvePages({ pages: [3, 1, 1, 2] }, 5)).toEqual([1, 2, 3]);
  });

  it('accepts closed ranges', () => {
    expect(resolvePages({ pages: '2-4' }, 6)).toEqual([2, 3, 4]);
  });

  it('accepts open-ended ranges', () => {
    expect(resolvePages({ pages: '3-' }, 5)).toEqual([3, 4, 5]);
  });

  it('accepts mixed lists of pages and ranges', () => {
    expect(resolvePages({ pages: '1,3-5,8' }, 10)).toEqual([1, 3, 4, 5, 8]);
  });

  it('tolerates whitespace in string selections', () => {
    expect(resolvePages({ pages: ' 1 , 3 - 4 ' }, 5)).toEqual([1, 3, 4]);
  });

  it('applies excludePages after pages', () => {
    expect(resolvePages({ pages: '1-5', excludePages: [2, 4] }, 5)).toEqual([1, 3, 5]);
  });

  it('can exclude page 1', () => {
    // percy-pdf could not: page 1 was structurally its base snapshot.
    expect(resolvePages({ excludePages: [1] }, 3)).toEqual([2, 3]);
  });

  it('can exclude the second-to-last page', () => {
    // percy-pdf could not: its execute script prefetched the following page.
    expect(resolvePages({ excludePages: [3] }, 4)).toEqual([1, 2, 4]);
  });

  it('ignores excluded pages that were never selected', () => {
    expect(resolvePages({ pages: [1, 2], excludePages: [5] }, 5)).toEqual([1, 2]);
  });

  it('throws when a requested page is out of range', () => {
    expect(() => resolvePages({ pages: '9' }, 5))
      .toThrowError('Requested page 9 but the document has only 5 pages');
    expect(() => resolvePages({ pages: [7, 8] }, 5))
      .toThrowError('Requested pages 7, 8 but the document has only 5 pages');
  });

  it('throws on a malformed selection', () => {
    expect(() => resolvePages({ pages: 'abc' }, 5))
      .toThrowError(/Invalid page selection "abc"/);
    expect(() => resolvePages({ pages: '5-2' }, 5))
      .toThrowError('Invalid page range "5-2": end page is before start page');
    expect(() => resolvePages({ pages: 0 }, 5))
      .toThrowError(/Invalid page number "0"/);
    expect(() => resolvePages({ pages: 1.5 }, 5))
      .toThrowError(/Invalid page number "1.5"/);
    expect(() => resolvePages({ pages: {} }, 5))
      .toThrowError(/expected a number, array or string, got object/);
  });

  it('throws when every page has been excluded', () => {
    expect(() => resolvePages({ excludePages: '1-3' }, 3))
      .toThrowError('No pages left to snapshot after applying `pages` and `excludePages`');
  });

  it('throws on an invalid page count', () => {
    expect(() => resolvePages({}, 0)).toThrowError('Invalid page count: 0');
  });
});
