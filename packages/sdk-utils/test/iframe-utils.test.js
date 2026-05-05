import {
  UNSUPPORTED_IFRAME_SRCS,
  DEFAULT_MAX_FRAME_DEPTH,
  HARD_MAX_FRAME_DEPTH,
  isUnsupportedIframeSrc,
  clampFrameDepth,
  normalizeIgnoreSelectors,
  resolveMaxFrameDepth,
  resolveIgnoreSelectors
} from '@percy/sdk-utils';

describe('iframe-utils', () => {
  describe('UNSUPPORTED_IFRAME_SRCS', () => {
    it('exposes the canonical list of unsupported src prefixes', () => {
      expect(UNSUPPORTED_IFRAME_SRCS).toEqual([
        'about:',
        'javascript:',
        'data:',
        'blob:',
        'vbscript:',
        'chrome:',
        'chrome-extension:'
      ]);
    });
  });

  describe('frame depth constants', () => {
    it('uses 10 as the default and 25 as the hard cap', () => {
      expect(DEFAULT_MAX_FRAME_DEPTH).toBe(10);
      expect(HARD_MAX_FRAME_DEPTH).toBe(25);
    });
  });

  describe('isUnsupportedIframeSrc', () => {
    it('returns true for falsy inputs', () => {
      expect(isUnsupportedIframeSrc(undefined)).toBe(true);
      expect(isUnsupportedIframeSrc(null)).toBe(true);
      expect(isUnsupportedIframeSrc('')).toBe(true);
    });

    it('returns true for unsupported lowercase prefixes', () => {
      expect(isUnsupportedIframeSrc('about:blank')).toBe(true);
      expect(isUnsupportedIframeSrc('javascript:void(0)')).toBe(true);
      expect(isUnsupportedIframeSrc('data:text/html,<p>x</p>')).toBe(true);
      expect(isUnsupportedIframeSrc('blob:https://x/abc')).toBe(true);
      expect(isUnsupportedIframeSrc('chrome-extension://abc/x.html')).toBe(true);
    });

    it('returns true for unsupported mixed-case prefixes', () => {
      expect(isUnsupportedIframeSrc('JavaScript:alert(1)')).toBe(true);
      expect(isUnsupportedIframeSrc('DATA:text/plain,foo')).toBe(true);
      expect(isUnsupportedIframeSrc('About:Blank')).toBe(true);
    });

    it('returns false for normal http(s) URLs', () => {
      expect(isUnsupportedIframeSrc('https://example.com')).toBe(false);
      expect(isUnsupportedIframeSrc('http://example.com/path')).toBe(false);
      expect(isUnsupportedIframeSrc('//cdn.example.com/x')).toBe(false);
    });

    it('coerces non-string values via String()', () => {
      expect(isUnsupportedIframeSrc({ toString: () => 'about:blank' })).toBe(true);
      expect(isUnsupportedIframeSrc({ toString: () => 'https://x' })).toBe(false);
    });
  });

  describe('clampFrameDepth', () => {
    it('falls back to default for non-finite or non-positive inputs', () => {
      expect(clampFrameDepth(undefined)).toBe(DEFAULT_MAX_FRAME_DEPTH);
      expect(clampFrameDepth(null)).toBe(DEFAULT_MAX_FRAME_DEPTH);
      expect(clampFrameDepth('foo')).toBe(DEFAULT_MAX_FRAME_DEPTH);
      expect(clampFrameDepth(NaN)).toBe(DEFAULT_MAX_FRAME_DEPTH);
      expect(clampFrameDepth(0)).toBe(DEFAULT_MAX_FRAME_DEPTH);
      expect(clampFrameDepth(-3)).toBe(DEFAULT_MAX_FRAME_DEPTH);
    });

    it('caps at HARD_MAX_FRAME_DEPTH', () => {
      expect(clampFrameDepth(50)).toBe(HARD_MAX_FRAME_DEPTH);
      expect(clampFrameDepth(HARD_MAX_FRAME_DEPTH + 1)).toBe(HARD_MAX_FRAME_DEPTH);
    });

    it('passes valid finite values through', () => {
      expect(clampFrameDepth(1)).toBe(1);
      expect(clampFrameDepth(15)).toBe(15);
      expect(clampFrameDepth(HARD_MAX_FRAME_DEPTH)).toBe(HARD_MAX_FRAME_DEPTH);
    });

    it('coerces numeric strings', () => {
      expect(clampFrameDepth('20')).toBe(20);
      expect(clampFrameDepth('100')).toBe(HARD_MAX_FRAME_DEPTH);
    });
  });

  describe('normalizeIgnoreSelectors', () => {
    it('returns an empty list for non-array inputs', () => {
      expect(normalizeIgnoreSelectors(undefined)).toEqual([]);
      expect(normalizeIgnoreSelectors(null)).toEqual([]);
      expect(normalizeIgnoreSelectors('not-an-array')).toEqual([]);
      expect(normalizeIgnoreSelectors({})).toEqual([]);
    });

    it('drops non-string and whitespace-only entries', () => {
      expect(normalizeIgnoreSelectors(['', '   ', '.x', null, 42, '.y']))
        .toEqual(['.x', '.y']);
    });

    it('preserves valid string selectors as-is', () => {
      expect(normalizeIgnoreSelectors(['.ad', '[data-ignore]']))
        .toEqual(['.ad', '[data-ignore]']);
    });
  });

  describe('resolveMaxFrameDepth', () => {
    it('reads options.maxIframeDepth and clamps it', () => {
      expect(resolveMaxFrameDepth({ maxIframeDepth: 5 })).toBe(5);
      expect(resolveMaxFrameDepth({ maxIframeDepth: 100 })).toBe(HARD_MAX_FRAME_DEPTH);
      expect(resolveMaxFrameDepth({ maxIframeDepth: -1 })).toBe(DEFAULT_MAX_FRAME_DEPTH);
    });

    it('falls back to the default when the option is absent', () => {
      expect(resolveMaxFrameDepth({})).toBe(DEFAULT_MAX_FRAME_DEPTH);
      expect(resolveMaxFrameDepth()).toBe(DEFAULT_MAX_FRAME_DEPTH);
    });
  });

  describe('resolveIgnoreSelectors', () => {
    it('reads options.ignoreIframeSelectors and normalizes the list', () => {
      expect(resolveIgnoreSelectors({ ignoreIframeSelectors: ['.x', '', null] }))
        .toEqual(['.x']);
    });

    it('falls back to an empty list when the option is absent', () => {
      expect(resolveIgnoreSelectors({})).toEqual([]);
      expect(resolveIgnoreSelectors()).toEqual([]);
    });
  });
});
