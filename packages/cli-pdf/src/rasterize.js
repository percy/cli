import path from 'path';
import { createRequire } from 'module';
import logger from '@percy/logger';
import { resolvePages } from './pages.js';

const require = createRequire(import.meta.url);

// Percy's API clamps snapshot widths/heights and cli-upload applies the same
// bounds to uploaded images. Mirror them here so a page raster is fitted to the
// limit up front (see fitScale) instead of being resized server side or
// rejected with a 422 partway through a build.
export const MIN_DIMENSION = 10;
export const MAX_DIMENSION = 2000;

export const DEFAULT_SCALE = 2;
export const MAX_SCALE = 5;

// pdf.js needs on-disk lookups for standard fonts (Helvetica, Times, ...) and
// for packed CMaps used by CJK documents. Without these it renders text with
// the wrong metrics or drops glyphs entirely, and only emits a warning -- which
// would show up as a mysterious visual diff rather than an error.
function pdfjsAssetPaths() {
  let root = path.dirname(require.resolve('pdfjs-dist/package.json'));
  return {
    standardFontDataUrl: path.join(root, 'standard_fonts') + path.sep,
    cMapUrl: path.join(root, 'cmaps') + path.sep,
    cMapPacked: true
  };
}

async function loadDocument(buffer) {
  // The legacy build is the one that runs outside a browser without needing
  // DOM globals or a worker; the default ESM build assumes a browser context.
  let pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');

  return pdfjs.getDocument({
    // pdf.js takes ownership of and may detach the buffer it is handed, so pass
    // a copy -- the caller still needs its Buffer intact for error messages.
    data: new Uint8Array(buffer),
    // Never eval PDF-supplied code. PDFs are untrusted input arriving over the
    // local API, and this is the one pdf.js switch that permits code execution.
    isEvalSupported: false,
    // Skip the interactive form layer: it renders widget annotations that a
    // headless raster has no use for and that vary between viewers.
    renderInteractiveForms: false,
    ...pdfjsAssetPaths()
  }).promise;
}

// The largest scale at which a page still fits inside Percy's dimension cap.
// Legal (612x1008pt) and A3 (842x1191pt) both exceed 2000px at the default
// scale of 2, and those are exactly the page sizes this feature targets, so
// hard-failing on them would be wrong. Fitting is deterministic from the page's
// own dimensions, so the same document always rasterizes identically -- which
// is what matters for a stable baseline.
export function fitScale(requestedScale, { width, height }) {
  return Math.min(requestedScale, MAX_DIMENSION / width, MAX_DIMENSION / height);
}

// Rasterizes one page to a PNG buffer at the given scale.
async function rasterizePage(doc, pageNumber, scale, log) {
  let { createCanvas } = await import('@napi-rs/canvas');
  let page = await doc.getPage(pageNumber);

  try {
    let unscaled = page.getViewport({ scale: 1 });
    let effectiveScale = fitScale(scale, unscaled);

    if (effectiveScale < scale) {
      log.warn(
        `Page ${pageNumber} is ${Math.round(unscaled.width)}x${Math.round(unscaled.height)}pt; ` +
        `scale reduced from ${scale} to ${effectiveScale.toFixed(3)} to stay within ` +
        `Percy's ${MAX_DIMENSION}px limit`
      );
    }

    let viewport = page.getViewport({ scale: effectiveScale });
    let width = Math.ceil(viewport.width);
    let height = Math.ceil(viewport.height);

    if (width < MIN_DIMENSION || height < MIN_DIMENSION) {
      throw new Error(
        `Page ${pageNumber} rasterized to ${width}x${height}px, below Percy's ` +
        `${MIN_DIMENSION}px minimum. Increase \`scale\`.`
      );
    }

    let canvas = createCanvas(width, height);
    let context = canvas.getContext('2d');

    // PDF pages have no intrinsic background. Without this, transparent regions
    // rasterize to alpha-0 black, which diffs against anything.
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, width, height);

    await page.render({ canvasContext: context, viewport }).promise;

    return {
      page: pageNumber,
      width,
      height,
      scale: effectiveScale,
      png: canvas.toBuffer('image/png')
    };
  } finally {
    // Release the page's internal render cache; without this a many-page
    // document holds every page's bitmap for the lifetime of the document.
    page.cleanup();
  }
}

// Rasterizes the selected pages of a PDF.
//
// `buffer`  - the raw PDF bytes
// `options` - { pages, excludePages, scale }
//
// Returns { pageCount, scale, pages: [{ page, width, height, png }] }
export async function rasterizePdf(buffer, options = {}) {
  let log = logger('pdf:rasterize');
  let scale = options.scale == null ? DEFAULT_SCALE : Number(options.scale);

  if (!Number.isFinite(scale) || scale <= 0 || scale > MAX_SCALE) {
    throw new Error(`Invalid scale ${options.scale}: expected a number between 0 and ${MAX_SCALE}`);
  }

  let doc = await loadDocument(buffer);

  try {
    let pageCount = doc.numPages;
    let selected = resolvePages(options, pageCount);

    log.debug(`Rasterizing ${selected.length} of ${pageCount} page(s) at scale ${scale}`);

    let pages = [];
    // Sequential on purpose: pdf.js shares one worker per document, so
    // rasterizing pages in parallel serializes on that worker anyway while
    // holding every page's bitmap in memory at once.
    for (let pageNumber of selected) {
      let rendered = await rasterizePage(doc, pageNumber, scale, log);
      log.debug(`Page ${pageNumber}: ${rendered.width}x${rendered.height}px, ${rendered.png.length} bytes`);
      pages.push(rendered);
    }

    return { pageCount, scale, pages };
  } finally {
    // Tears down the pdf.js worker. Skipping this leaks a worker per request
    // and keeps the CLI process alive after the build finishes.
    await doc.destroy();
  }
}
