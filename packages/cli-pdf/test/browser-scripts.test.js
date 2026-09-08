import {
  fitScale, assertRasterDimensions,
  MIN_DIMENSION, MAX_DIMENSION, DEFAULT_SCALE, MAX_SCALE,
  openDocument, measurePages, renderPage, destroyDocument
} from '../src/browser-scripts.js';

describe('@percy/cli-pdf browser scripts', () => {
  describe('fitScale', () => {
    it('returns the requested scale when the page fits', () => {
      expect(fitScale(2, { width: 612, height: 792 })).toBe(2);
    });

    it('clamps on the constraining axis', () => {
      expect(fitScale(2, { width: 612, height: 1008 })).toBeCloseTo(MAX_DIMENSION / 1008, 6);
      expect(fitScale(4, { width: 1000, height: 100 })).toBeCloseTo(MAX_DIMENSION / 1000, 6);
    });
  });

  describe('assertRasterDimensions', () => {
    it('accepts dimensions at or above the minimum', () => {
      expect(() => assertRasterDimensions(1, MIN_DIMENSION, MIN_DIMENSION)).not.toThrow();
    });

    it('rejects a raster below the minimum', () => {
      expect(() => assertRasterDimensions(3, 4, 400))
        .toThrowError(/Page 3 rasterized to 4x400px, below Percy's 10px minimum/);
      expect(() => assertRasterDimensions(1, 400, 4))
        .toThrowError(/below Percy's 10px minimum/);
    });
  });

  it('exposes the limits the rasterizer enforces', () => {
    expect(MIN_DIMENSION).toBe(10);
    expect(MAX_DIMENSION).toBe(2000);
    expect(DEFAULT_SCALE).toBe(2);
    expect(MAX_SCALE).toBe(5);
  });

  describe('page-context scripts', () => {
    it('are plain functions whose source can be shipped to the page', () => {
      for (let fn of [openDocument, measurePages, renderPage, destroyDocument]) {
        expect(typeof fn).toBe('function');
        let src = fn.toString();
        expect(src).toContain('async');
        expect(src).not.toContain('[native code]');
      }
    });

    it('reach pdf.js and the DOM only through page globals', () => {
      expect(openDocument.toString()).toContain('window');
      expect(renderPage.toString()).toContain('document.createElement');
    });

    it('take Percy helpers as the first argument', () => {
      expect(openDocument.length).toBe(2);
      expect(measurePages.length).toBe(2);
      expect(renderPage.length).toBe(2);
    });

    it('destroyDocument is a no-op when no document is open', async () => {
      global.window = {};
      try {
        await expectAsync(destroyDocument()).toBeResolvedTo(true);
      } finally {
        delete global.window;
      }
    });
  });
});
