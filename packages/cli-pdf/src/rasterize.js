import path from 'path';
import { createRequire } from 'module';
import logger from '@percy/logger';
import { resolvePages } from './pages.js';

const cjsRequire = createRequire(import.meta.url);

export const MIN_DIMENSION = 10;
export const MAX_DIMENSION = 2000;

export const DEFAULT_SCALE = 2;
export const MAX_SCALE = 5;

function pdfjsAssetPaths() {
  let root = path.dirname(cjsRequire.resolve('pdfjs-dist/package.json'));
  return {
    standardFontDataUrl: path.join(root, 'standard_fonts') + path.sep,
    cMapUrl: path.join(root, 'cmaps') + path.sep,
    cMapPacked: true
  };
}

async function loadDocument(buffer) {
  let mod = await import('pdfjs-dist/legacy/build/pdf.js');
  let pdfjs = mod.default ?? mod;

  return pdfjs.getDocument({
    data: new Uint8Array(buffer),
    isEvalSupported: false,
    ...pdfjsAssetPaths()
  }).promise;
}

export function fitScale(requestedScale, { width, height }) {
  return Math.min(requestedScale, MAX_DIMENSION / width, MAX_DIMENSION / height);
}

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
    page.cleanup();
  }
}

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

    for (let pageNumber of selected) {
      let rendered = await rasterizePage(doc, pageNumber, scale, log);
      log.debug(`Page ${pageNumber}: ${rendered.width}x${rendered.height}px, ${rendered.png.length} bytes`);
      pages.push(rendered);
    }

    return { pageCount, scale, pages };
  } finally {
    await doc.destroy();
  }
}
