import fs from 'fs';
import logger from '@percy/logger';
import { Server } from './server.js';

async function createAssetServer(pdfBuffer, assets) {
  let server = Server.createServer({ port: 0 });

  server.serve('/pdfjs', assets.buildDir);
  server.serve('/standard_fonts', assets.standardFontsDir);
  server.serve('/cmaps', assets.cmapsDir);

  server.route('get', '/doc.pdf', (req, res) => (
    res.send(200, 'application/pdf', pdfBuffer)
  ));

  server.route('get', '/', (req, res) => (
    res.send(200, 'text/html', '<!doctype html><html><head><meta charset="utf-8"></head><body></body></html>')
  ));

  await server.listen();
  return server;
}

export async function rasterizePdf(percy, pdfBuffer, options) {
  let log = logger('core:pdf-rasterize');

  let {
    pdfjsAssets, resolvePages, fitScale, assertRasterDimensions,
    openDocument, measurePages, renderPage, destroyDocument,
    DEFAULT_SCALE, MAX_SCALE
  } = await import('@percy/cli-pdf');

  let scale = options.scale == null ? DEFAULT_SCALE : Number(options.scale);

  if (!Number.isFinite(scale) || scale <= 0 || scale > MAX_SCALE) {
    throw new Error(`Invalid scale ${options.scale}: expected a number between 0 and ${MAX_SCALE}`);
  }

  let assets = pdfjsAssets();
  let server = await createAssetServer(pdfBuffer, assets);
  let origin = server.address();
  let page;

  try {
    await percy.browser.launch();
    page = await percy.browser.page({ meta: { snapshot: { name: 'pdf' } } });
    await page.goto(`${origin}/`);

    let pdfjsSource = await fs.promises.readFile(assets.libPath, 'utf-8');
    await page.eval(new Function(pdfjsSource)); /* eslint-disable-line no-new-func */

    let { pageCount } = await page.eval(openDocument, { origin });
    let selected = resolvePages(options, pageCount);

    log.debug(`Rendering ${selected.length} of ${pageCount} page(s) at scale ${scale}`);

    let sizes = await page.eval(measurePages, { pageNumbers: selected });
    let pages = [];

    for (let { pageNumber, width, height } of sizes) {
      let effectiveScale = fitScale(scale, { width, height });

      if (effectiveScale < scale) {
        log.warn(
          `Page ${pageNumber} is ${Math.round(width)}x${Math.round(height)}pt; ` +
          `scale reduced from ${scale} to ${effectiveScale.toFixed(3)} to stay within ` +
          'Percy\'s 2000px limit'
        );
      }

      let rendered = await page.eval(renderPage, { pageNumber, scale: effectiveScale });
      assertRasterDimensions(pageNumber, rendered.width, rendered.height);

      let png = Buffer.from(rendered.dataUrl.slice(rendered.dataUrl.indexOf(',') + 1), 'base64');

      log.debug(`Page ${pageNumber}: ${rendered.width}x${rendered.height}px, ${png.length} bytes`);

      pages.push({
        page: pageNumber,
        width: rendered.width,
        height: rendered.height,
        scale: effectiveScale,
        png
      });
    }

    await page.eval(destroyDocument);

    return { pageCount, scale, pages };
  } finally {
    await page?.close();
    await server.close();
  }
}
