import logger from '@percy/logger';
import PercyConfig from '@percy/config';
import { ServerError } from './server.js';
import { handleSyncJob } from './snapshot.js';
import { rasterizePdf } from './pdf-rasterize.js';
import { createResource, createRootResource, normalizeOptions } from './utils.js';

const MAX_PDF_BYTES = 50 * 1024 * 1024;
const PDF_MAGIC = Buffer.from('%PDF-', 'latin1');

export function pageSnapshotName(name, pageNumber) {
  return `${name} | Page ${pageNumber}`;
}

function pageUrls(name, pageNumber) {
  let base = `http://local/${encodeURIComponent(name)}/page-${pageNumber}`;
  return { rootUrl: base, imageUrl: `${base}.png` };
}

export function decodePdf(pdf) {
  if (!pdf || typeof pdf !== 'object') {
    throw new ServerError(400, 'Missing required `pdf` object');
  }

  let { content } = pdf;

  if (typeof content !== 'string' || !content.length) {
    throw new ServerError(400, 'Missing required `pdf.content` (base64-encoded PDF)');
  }

  let buffer = Buffer.from(content, 'base64');

  if (buffer.length < PDF_MAGIC.length) {
    throw new ServerError(400, '`pdf.content` is not valid base64-encoded data');
  }

  if (buffer.length > MAX_PDF_BYTES) {
    throw new ServerError(413, `PDF exceeds the maximum size of ${MAX_PDF_BYTES / 1024 / 1024}MB`);
  }

  if (!buffer.subarray(0, PDF_MAGIC.length).equals(PDF_MAGIC)) {
    throw new ServerError(400, '`pdf.content` does not decode to a PDF (missing %PDF- header)');
  }

  return buffer;
}

export async function loadPdfModule(load = () => import('@percy/cli-pdf')) {
  try {
    return await load();
  } catch (error) {
    throw new ServerError(501, [
      'PDF snapshots require the @percy/cli-pdf package, which is not installed.',
      'Install it with: npm install --save-dev @percy/cli-pdf',
      `(underlying error: ${error.message})`
    ].join(' '));
  }
}

function validatePdfSnapshotOptions(options) {
  let log = logger('core:pdf-snapshot');
  let normalized = normalizeOptions(options);
  let { clientInfo, environmentInfo, pdf, ...validatable } = normalized;

  let errors = PercyConfig.validate(validatable, '/pdf-snapshot');

  if (errors?.length > 0) {
    log.warn('Invalid PDF snapshot options:');
    for (let e of errors) log.warn(`- ${e.path}: ${e.message}`);
  }

  return normalized;
}

function queuePages(percy, { name, rendered, sync, snapshotOptions }) {
  return rendered.map(({ page, width, height, png }) => {
    let snapshotName = pageSnapshotName(name, page);
    let { rootUrl, imageUrl } = pageUrls(name, page);

    let options = {
      ...snapshotOptions,
      name: snapshotName,
      widths: snapshotOptions.widths || [width],
      minHeight: snapshotOptions.minHeight || height,
      resources: () => buildPageResources({ rootUrl, imageUrl, snapshotName, width, height, png })
    };

    if (sync) options.sync = true;

    let promise = null;

    if (sync) {
      promise = new Promise((resolve, reject) => {
        percy.upload(options, { resolve, reject }).catch(reject);
      });
    } else {
      percy.upload(options);
    }

    return { page, snapshotName, promise };
  });
}

async function buildPageResources({ rootUrl, imageUrl, snapshotName, width, height, png }) {
  let { buildPageHtml } = await loadPdfModule();

  return [
    createRootResource(rootUrl, buildPageHtml({ title: snapshotName, imageUrl, width, height })),
    createResource(imageUrl, png, 'image/png')
  ];
}

export async function handlePdfSnapshot(req, res, percy) {
  let log = logger('core:pdf-snapshot');
  let body = req.body;

  if (!body || typeof body !== 'object' || Array.isArray(body) || Buffer.isBuffer(body)) {
    throw new ServerError(400, 'Expected a JSON object body');
  }

  let { name, pdf, pages, excludePages, scale, ...rest } = validatePdfSnapshotOptions(body);

  if (typeof name !== 'string' || !name.trim()) {
    throw new ServerError(400, 'Missing required `name`');
  }

  let buffer = decodePdf(pdf);
  await loadPdfModule();

  let sync = percy.syncMode(rest);

  let rasterized;

  try {
    rasterized = await rasterizePdf(percy, buffer, { pages, excludePages, scale });
  } catch (error) {
    log.error(`Failed to rasterize PDF "${name}": ${error.message}`);
    throw new ServerError(400, `Could not rasterize PDF: ${error.message}`);
  }

  let { pageCount, pages: rendered } = rasterized;

  percy.client.addClientInfo(rest.clientInfo);
  percy.client.addEnvironmentInfo(rest.environmentInfo);

  let { clientInfo, environmentInfo, sync: _sync, ...snapshotOptions } = rest;

  log.info(
    `PDF "${name}": snapshotting ${rendered.length} of ${pageCount} page(s)` +
    (sync ? ' (waiting for comparison results)' : '')
  );

  let queued = queuePages(percy, { name, rendered, sync, snapshotOptions });

  if (!sync) {
    return res.json(200, {
      success: true,
      data: {
        'pdf-name': name,
        'page-count': pageCount,
        'pages-snapshotted': queued.length,
        status: 'queued',
        pages: queued.map(({ page, snapshotName }) => ({
          page,
          'snapshot-name': snapshotName
        }))
      }
    });
  }

  let results = await Promise.all(
    queued.map(async ({ page, snapshotName, promise }) => ({
      ...await handleSyncJob(promise, percy, 'snapshot'),
      page,
      'snapshot-name': snapshotName
    }))
  );

  let failed = results.filter(r => r.error || r.status === 'failure');

  return res.json(200, {
    success: true,
    data: {
      'pdf-name': name,
      'page-count': pageCount,
      'pages-snapshotted': results.length,
      status: failed.length ? 'failure' : 'success',
      pages: results
    }
  });
}
