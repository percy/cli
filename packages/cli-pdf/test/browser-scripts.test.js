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

    it('rejects a raster below the minimum on either axis', () => {
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

  // These four run inside the browser page, reaching pdf.js and the canvas
  // through `window` / `document`. Standing those globals up here exercises the
  // real logic in Node -- the fetch URLs pdf.js is handed, the white pre-fill,
  // and the page-handle cleanup -- rather than leaving it to an integration run.
  describe('page-context scripts', () => {
    let doc, pages, renderCalls, createdCanvases;

    function fakePage(pageNumber, { width = 612, height = 792, renderError } = {}) {
      let page = {
        pageNumber,
        cleanedUp: false,
        getViewport: ({ scale }) => ({ width: width * scale, height: height * scale }),
        render: (opts) => {
          renderCalls.push({ pageNumber, opts });
          return { promise: renderError ? Promise.reject(renderError) : Promise.resolve() };
        },
        cleanup: () => { page.cleanedUp = true; }
      };
      return page;
    }

    function stubPageGlobals({ numPages = 3, pageOptions = {}, lib } = {}) {
      pages = new Map();
      renderCalls = [];
      createdCanvases = [];

      doc = {
        numPages,
        destroyed: false,
        getPage: async (n) => {
          let page = fakePage(n, pageOptions[n] || {});
          pages.set(n, page);
          return page;
        },
        destroy: async () => { doc.destroyed = true; }
      };

      global.window = lib === null ? {} : { 'pdfjs-dist/build/pdf': lib || stubLib() };
      global.document = {
        createElement: (tag) => {
          let canvas = {
            tag,
            width: 0,
            height: 0,
            fills: [],
            getContext: () => ({
              set fillStyle(v) { canvas.fillStyle = v; },
              get fillStyle() { return canvas.fillStyle; },
              fillRect: (...args) => canvas.fills.push(args)
            }),
            toDataURL: (type) => `data:${type};base64,UE5H`
          };
          createdCanvases.push(canvas);
          return canvas;
        }
      };
    }

    function stubLib() {
      return {
        GlobalWorkerOptions: {},
        getDocumentCalls: [],
        getDocument(options) {
          this.getDocumentCalls.push(options);
          return { promise: Promise.resolve(doc) };
        }
      };
    }

    afterEach(() => {
      delete global.window;
      delete global.document;
    });

    describe('openDocument', () => {
      it('points pdf.js at the served worker, document, fonts and cmaps', async () => {
        stubPageGlobals({ numPages: 4 });
        let lib = global.window['pdfjs-dist/build/pdf'];

        await expectAsync(openDocument(null, { origin: 'http://localhost:9999' }))
          .toBeResolvedTo({ pageCount: 4 });

        expect(lib.GlobalWorkerOptions.workerSrc)
          .toBe('http://localhost:9999/pdfjs/pdf.worker.js');

        let [options] = lib.getDocumentCalls;
        expect(options.url).toBe('http://localhost:9999/doc.pdf');
        expect(options.standardFontDataUrl).toBe('http://localhost:9999/standard_fonts/');
        expect(options.cMapUrl).toBe('http://localhost:9999/cmaps/');
        expect(options.cMapPacked).toBe(true);
        // the PDF is untrusted input; this must never be enabled
        expect(options.isEvalSupported).toBe(false);
      });

      it('stashes the handle for the later scripts', async () => {
        stubPageGlobals();
        await openDocument(null, { origin: 'http://localhost:1' });

        expect(global.window.__percyPdf.doc).toBe(doc);
      });

      it('falls back to the window.pdfjsLib global', async () => {
        stubPageGlobals({ lib: null });
        let lib = stubLib();
        global.window.pdfjsLib = lib;

        await expectAsync(openDocument(null, { origin: 'http://localhost:2' }))
          .toBeResolvedTo({ pageCount: 3 });
        expect(lib.getDocumentCalls.length).toBe(1);
      });

      it('throws when pdf.js did not initialise', async () => {
        stubPageGlobals({ lib: null });

        await expectAsync(openDocument(null, { origin: 'http://localhost:3' }))
          .toBeRejectedWithError('pdf.js did not initialise in the page');
      });
    });

    describe('measurePages', () => {
      it('returns each page unscaled and releases the handles', async () => {
        stubPageGlobals({ pageOptions: { 2: { width: 200, height: 400 } } });
        await openDocument(null, { origin: 'http://localhost:4' });

        await expectAsync(measurePages(null, { pageNumbers: [1, 2] })).toBeResolvedTo([
          { pageNumber: 1, width: 612, height: 792 },
          { pageNumber: 2, width: 200, height: 400 }
        ]);

        expect(pages.get(1).cleanedUp).toBe(true);
        expect(pages.get(2).cleanedUp).toBe(true);
      });
    });

    describe('renderPage', () => {
      it('renders at the given scale and returns a PNG data URL', async () => {
        stubPageGlobals();
        await openDocument(null, { origin: 'http://localhost:5' });

        let out = await renderPage(null, { pageNumber: 1, scale: 2 });

        expect(out.width).toBe(1224);
        expect(out.height).toBe(1584);
        expect(out.dataUrl).toBe('data:image/png;base64,UE5H');
        expect(createdCanvases[0].tag).toBe('canvas');
      });

      it('rounds fractional viewports up', async () => {
        stubPageGlobals({ pageOptions: { 1: { width: 100.2, height: 100.6 } } });
        await openDocument(null, { origin: 'http://localhost:6' });

        let out = await renderPage(null, { pageNumber: 1, scale: 1 });
        expect(out.width).toBe(101);
        expect(out.height).toBe(101);
      });

      it('pre-fills the canvas white', async () => {
        // PDF pages have no intrinsic background; without this, transparent
        // regions rasterize to alpha-0 black and diff against anything.
        stubPageGlobals();
        await openDocument(null, { origin: 'http://localhost:7' });
        await renderPage(null, { pageNumber: 1, scale: 1 });

        expect(createdCanvases[0].fillStyle).toBe('#ffffff');
        expect(createdCanvases[0].fills).toEqual([[0, 0, 612, 792]]);
      });

      it('passes the canvas context and viewport to pdf.js', async () => {
        stubPageGlobals();
        await openDocument(null, { origin: 'http://localhost:8' });
        await renderPage(null, { pageNumber: 3, scale: 1 });

        expect(renderCalls.length).toBe(1);
        expect(renderCalls[0].pageNumber).toBe(3);
        expect(renderCalls[0].opts.canvasContext).toBeDefined();
        expect(renderCalls[0].opts.viewport).toEqual({ width: 612, height: 792 });
      });

      it('releases the page handle even when rendering fails', async () => {
        stubPageGlobals({ pageOptions: { 1: { renderError: new Error('render blew up') } } });
        await openDocument(null, { origin: 'http://localhost:9' });

        await expectAsync(renderPage(null, { pageNumber: 1, scale: 1 }))
          .toBeRejectedWithError('render blew up');
        expect(pages.get(1).cleanedUp).toBe(true);
      });
    });

    describe('destroyDocument', () => {
      it('destroys the document and clears the handle', async () => {
        stubPageGlobals();
        await openDocument(null, { origin: 'http://localhost:10' });

        await expectAsync(destroyDocument()).toBeResolvedTo(true);
        expect(doc.destroyed).toBe(true);
        expect(global.window.__percyPdf).toBeUndefined();
      });

      it('is a no-op when no document is open', async () => {
        global.window = {};
        await expectAsync(destroyDocument()).toBeResolvedTo(true);
      });
    });
  });
});
