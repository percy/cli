import { rasterizePdf, fitScale, MAX_DIMENSION, DEFAULT_SCALE } from '../src/rasterize.js';
import { buildPdf, NOT_A_PDF } from './fixture.js';

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

describe('@percy/cli-pdf rasterize', () => {
  it('rasterizes every page by default', async () => {
    let { pageCount, pages } = await rasterizePdf(buildPdf({ pageCount: 3 }));

    expect(pageCount).toBe(3);
    expect(pages.map(p => p.page)).toEqual([1, 2, 3]);
  });

  it('returns real PNG data sized from the page and scale', async () => {
    let { pages } = await rasterizePdf(buildPdf({ width: 200, height: 300 }), { scale: 2 });
    let [page] = pages;

    expect(page.width).toBe(400);
    expect(page.height).toBe(600);
    expect(page.png.subarray(0, 8).equals(PNG_MAGIC)).toBe(true);
  });

  it('defaults to a scale of 2', async () => {
    let { pages } = await rasterizePdf(buildPdf({ width: 100, height: 100 }));

    expect(pages[0].width).toBe(100 * DEFAULT_SCALE);
    expect(pages[0].scale).toBe(DEFAULT_SCALE);
  });

  it('produces a DIFFERENT image for each page', async () => {
    // Regression guard: the img src in the generated DOM was once double
    // percent-encoded, so it never matched the image resource URL and every
    // page rendered as the same blank sheet -- which reports zero diffs for
    // documents that really changed. Distinct rasters are the precondition for
    // that bug being detectable at all.
    let { pages } = await rasterizePdf(buildPdf({ pageCount: 3 }));
    let distinct = new Set(pages.map(p => p.png.toString('base64')));

    expect(distinct.size).toBe(3);
  });

  it('only rasterizes the selected pages', async () => {
    let { pageCount, pages } = await rasterizePdf(buildPdf({ pageCount: 5 }), {
      pages: '1-4',
      excludePages: [2]
    });

    expect(pageCount).toBe(5);
    expect(pages.map(p => p.page)).toEqual([1, 3, 4]);
  });

  it('fits the scale down so a tall page stays within Percy limits', async () => {
    // US Legal at scale 2 would be 1224x2016 -- over the 2000px cap.
    let { pages } = await rasterizePdf(buildPdf({ width: 612, height: 1008 }), { scale: 2 });

    expect(pages[0].height).toBeLessThanOrEqual(MAX_DIMENSION);
    expect(pages[0].scale).toBeLessThan(2);
  });

  it('leaves the scale alone when the page already fits', async () => {
    // US Letter at scale 2 is 1224x1584 -- comfortably inside the cap.
    let { pages } = await rasterizePdf(buildPdf({ width: 612, height: 792 }), { scale: 2 });

    expect(pages[0].scale).toBe(2);
    expect(pages[0].width).toBe(1224);
    expect(pages[0].height).toBe(1584);
  });

  it('rejects an invalid scale', async () => {
    for (let scale of [0, -1, 6, 'big', NaN]) {
      await expectAsync(rasterizePdf(buildPdf(), { scale }))
        .toBeRejectedWithError(/Invalid scale/);
    }
  });

  it('rejects a page raster below the minimum dimension', async () => {
    await expectAsync(rasterizePdf(buildPdf({ width: 4, height: 4 }), { scale: 1 }))
      .toBeRejectedWithError(/below Percy's 10px minimum/);
  });

  it('rejects data that is not a PDF', async () => {
    await expectAsync(rasterizePdf(NOT_A_PDF)).toBeRejected();
  });

  describe('fitScale', () => {
    it('returns the requested scale when the page fits', () => {
      expect(fitScale(2, { width: 612, height: 792 })).toBe(2);
    });

    it('clamps on the constraining axis', () => {
      expect(fitScale(2, { width: 612, height: 1008 })).toBeCloseTo(MAX_DIMENSION / 1008, 6);
      expect(fitScale(4, { width: 1000, height: 100 })).toBeCloseTo(MAX_DIMENSION / 1000, 6);
    });
  });
});
