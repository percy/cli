export const MIN_DIMENSION = 10;
export const MAX_DIMENSION = 2000;

export const DEFAULT_SCALE = 2;
export const MAX_SCALE = 5;

// Wall-clock ceiling for a single page's in-page work (open, measure, render).
// Page#eval resolves off `Runtime.callFunctionOn` with `awaitPromise: true`,
// which has no timeout of its own -- Page.TIMEOUT only covers navigation. A PDF
// that wedges pdf.js would otherwise hang the HTTP request forever while
// holding a browser page and a listening asset server.
export const PAGE_RENDER_TIMEOUT = 30000;

export function fitScale(requestedScale, { width, height }) {
  return Math.min(requestedScale, MAX_DIMENSION / width, MAX_DIMENSION / height);
}

export function assertRasterDimensions(pageNumber, width, height) {
  if (width < MIN_DIMENSION || height < MIN_DIMENSION) {
    throw new Error(
      `Page ${pageNumber} rasterized to ${width}x${height}px, below Percy's ` +
      `${MIN_DIMENSION}px minimum. Increase \`scale\`.`
    );
  }
}

// pdfjs-dist v4 is ESM only -- there is no UMD bundle left to read off disk and
// eval into the page, so the library is imported as a module from the asset
// server and parked on `window.pdfjsLib` for the scripts that follow. The
// element's error event is the only signal for an import that never resolves.
export async function loadLibrary(_, { origin, libFile }) {
  if (window.pdfjsLib) return true;

  let loaded = new Promise((resolve, reject) => {
    window.__percyPdfLoad = { resolve, reject };
  });

  let script = document.createElement('script');
  script.type = 'module';
  script.textContent = [
    `import * as lib from '${origin}/pdfjs/${libFile}';`,
    'window.pdfjsLib = lib;',
    'window.__percyPdfLoad.resolve();'
  ].join('\n');

  script.onerror = () => window.__percyPdfLoad.reject(
    new Error('pdf.js failed to load in the page')
  );

  document.head.appendChild(script);

  try {
    await loaded;
  } finally {
    delete window.__percyPdfLoad;
  }

  return true;
}

export async function openDocument(_, { origin, workerFile }) {
  let lib = window.pdfjsLib;

  if (!lib) {
    throw new Error('pdf.js did not initialise in the page');
  }

  lib.GlobalWorkerOptions.workerSrc = `${origin}/pdfjs/${workerFile}`;

  let doc = await lib.getDocument({
    url: `${origin}/doc.pdf`,
    isEvalSupported: false,
    standardFontDataUrl: `${origin}/standard_fonts/`,
    cMapUrl: `${origin}/cmaps/`,
    cMapPacked: true
  }).promise;

  window.__percyPdf = { lib, doc };

  return { pageCount: doc.numPages };
}

export async function measurePages(_, { pageNumbers }) {
  let { doc } = window.__percyPdf;
  let sizes = [];

  for (let pageNumber of pageNumbers) {
    let page = await doc.getPage(pageNumber);
    let { width, height } = page.getViewport({ scale: 1 });
    sizes.push({ pageNumber, width, height });
    page.cleanup();
  }

  return sizes;
}

export async function renderPage(_, { pageNumber, scale }) {
  let { doc } = window.__percyPdf;
  let page = await doc.getPage(pageNumber);

  try {
    let viewport = page.getViewport({ scale });
    let width = Math.ceil(viewport.width);
    let height = Math.ceil(viewport.height);

    let canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;

    let context = canvas.getContext('2d');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, width, height);

    await page.render({ canvasContext: context, viewport }).promise;

    return {
      width,
      height,
      dataUrl: canvas.toDataURL('image/png')
    };
  } finally {
    page.cleanup();
  }
}

export async function destroyDocument() {
  let state = window.__percyPdf;

  if (state?.doc) {
    await state.doc.destroy();
    delete window.__percyPdf;
  }

  return true;
}
