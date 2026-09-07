import logger from '@percy/logger';
import PercyConfig from '@percy/config';
import { ServerError } from './server.js';
import { handleSyncJob } from './snapshot.js';
import { createResource, createRootResource, normalizeOptions } from './utils.js';

// Matches the cap on /percy/comparison/upload so the two binary-accepting
// endpoints behave the same. Applied to the DECODED size: base64 inflates by
// ~33%, so the wire body may legitimately be larger than this.
const MAX_PDF_BYTES = 50 * 1024 * 1024;
const PDF_MAGIC = Buffer.from('%PDF-', 'latin1');

// Snapshot name suffix for each page. Deliberately matches the convention the
// percy-pdf repo used (`<name> | Page N`) so a team migrating off it keeps its
// existing Percy baselines instead of orphaning every approved snapshot.
export function pageSnapshotName(name, pageNumber) {
  return `${name} | Page ${pageNumber}`;
}

// Resource URLs for a page. `http://local/...` mirrors cli-upload's synthetic
// host for generated image DOMs -- it is never fetched, it only has to be a
// stable, unique URL so resource SHAs are reproducible across builds.
function pageUrls(name, pageNumber) {
  let base = `http://local/${encodeURIComponent(name)}/page-${pageNumber}`;
  return { rootUrl: base, imageUrl: `${base}.png` };
}

// Decodes and sanity-checks the incoming PDF. Everything here is caller error,
// so each branch is a 400 rather than a 500.
export function decodePdf(pdf) {
  if (!pdf || typeof pdf !== 'object') {
    throw new ServerError(400, 'Missing required `pdf` object');
  }

  let { content } = pdf;

  if (typeof content !== 'string' || !content.length) {
    throw new ServerError(400, 'Missing required `pdf.content` (base64-encoded PDF)');
  }

  let buffer = Buffer.from(content, 'base64');

  // Buffer.from silently drops invalid base64 characters rather than throwing,
  // so an empty or absurdly short result is how a malformed payload surfaces.
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

// @percy/cli-pdf is an optionalDependency: it pulls in pdfjs-dist and the
// platform-specific @napi-rs/canvas prebuilds, which users who never snapshot a
// PDF should not have to install. Absent, we owe them an actionable message
// rather than a raw MODULE_NOT_FOUND.
export async function loadPdfModule() {
  try {
    return await import('@percy/cli-pdf');
  } catch (error) {
    throw new ServerError(501, [
      'PDF snapshots require the @percy/cli-pdf package, which is not installed.',
      'Install it with: npm install --save-dev @percy/cli-pdf',
      `(underlying error: ${error.message})`
    ].join(' '));
  }
}

// Validates the request against the /pdf-snapshot schema. Mirrors
// validateSnapshotOptions: warn rather than reject, so a newer SDK sending an
// option this CLI does not know about degrades instead of failing the build.
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

// Pushes one snapshot per rasterized page onto the upload queue.
//
// Each page carries `resources` and no `tag`, so createSnapshotsQueue's task
// handler routes it through client.sendSnapshot -- a real web snapshot, not a
// comparison. Returns one entry per page, each with the sync promise when
// syncing (resolved by the queue with the snapshot id) or null otherwise.
function queuePages(percy, { name, rendered, sync, snapshotOptions }) {
  return rendered.map(({ page, width, height, png }) => {
    let snapshotName = pageSnapshotName(name, page);
    let { rootUrl, imageUrl } = pageUrls(name, page);

    let options = {
      ...snapshotOptions,
      name: snapshotName,
      // The raster is fixed-size, so render it at exactly its own dimensions
      // unless the caller deliberately overrode them.
      widths: snapshotOptions.widths || [width],
      minHeight: snapshotOptions.minHeight || height,
      // A function defers the work into the queue task, which is where
      // concurrency is applied -- see createSnapshotsQueue's 'task' handler.
      resources: () => buildPageResources({ rootUrl, imageUrl, snapshotName, width, height, png })
    };

    if (sync) options.sync = true;

    let promise = null;

    if (sync) {
      // Same shape as the /percy/comparison route: percy.upload is the
      // generatePromise-wrapped method, and syncMode() copies resolve/reject
      // onto the snapshot so the sync queue can settle them. The trailing
      // .catch(reject) surfaces errors thrown before the queue task runs,
      // which would otherwise hang the request.
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

// POST /percy/pdf/snapshot
//
// Accepts a base64 PDF, rasterizes the selected pages, and creates one Percy
// snapshot per page. With `sync: true` it blocks until every page has been
// compared and returns an aggregate object (never a bare array -- the .NET
// wrapper parses this with JObject.Parse).
export async function handlePdfSnapshot(req, res, percy) {
  let log = logger('core:pdf-snapshot');
  let body = req.body;

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new ServerError(400, 'Expected a JSON object body');
  }

  let { name, pdf, pages, excludePages, scale, ...rest } = validatePdfSnapshotOptions(body);

  if (typeof name !== 'string' || !name.trim()) {
    throw new ServerError(400, 'Missing required `name`');
  }

  let buffer = decodePdf(pdf);
  let { rasterizePdf } = await loadPdfModule();

  // syncMode() also force-disables sync under skipUploads/deferUploads/
  // delayUploads and warns about it, so this is the single source of truth for
  // whether we wait -- do not read `rest.sync` directly.
  let sync = percy.syncMode(rest);

  let rasterized;

  try {
    rasterized = await rasterizePdf(buffer, { pages, excludePages, scale });
  } catch (error) {
    // A malformed or unsupported document, or an impossible page selection, is
    // the caller's input -- report it as such instead of a 500.
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

  // handleSyncJob never rejects -- it converts failures into { error } -- so
  // one bad page yields a partial result rather than losing every other page's.
  let results = await Promise.all(
    queued.map(async ({ page, snapshotName, promise }) => ({
      ...await handleSyncJob(promise, percy, 'snapshot'),
      // Set AFTER the spread so they always win. The API happens to echo back
      // the same snapshot-name today, but the page number and the name we
      // submitted are what we know to be authoritative -- letting the response
      // overwrite them would silently break the caller's page mapping if the
      // API ever omitted or reformatted either.
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
