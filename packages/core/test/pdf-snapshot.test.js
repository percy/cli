import { logger, setupTest } from './helpers/index.js';
import { request } from './helpers/request.js';
import Percy from '@percy/core';
import { decodePdf, pageSnapshotName, loadPdfModule } from '../src/pdf-snapshot.js';

function buildPdf({ pageCount = 1, width = 200, height = 300 } = {}) {
  let objects = [];
  let pageIds = [];
  for (let i = 0; i < pageCount; i++) pageIds.push(3 + i * 2);

  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map(id => `${id} 0 R`).join(' ')}] /Count ${pageCount} >>`;

  for (let i = 0; i < pageCount; i++) {
    let pageId = pageIds[i];
    let contentId = pageId + 1;
    let inset = 10 + i * 15;
    let stream = `${inset} ${inset} ${width - inset * 2} ${height - inset * 2} re f`;
    objects[pageId] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] ` +
      `/Contents ${contentId} 0 R /Resources << >> >>`;
    objects[contentId] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  }

  let out = '%PDF-1.4\n';
  let offsets = [];
  for (let i = 1; i < objects.length; i++) {
    offsets[i] = out.length;
    out += `${i} 0 obj\n${objects[i]}\nendobj\n`;
  }
  let xrefStart = out.length;
  out += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let i = 1; i < objects.length; i++) {
    out += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  out += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

const b64 = (buf) => buf.toString('base64');

describe('PDF snapshots', () => {
  let percy;

  function post(body) {
    return request(new URL('/percy/pdf/snapshot', percy.address()), { method: 'POST', body });
  }

  function postRaw(body) {
    return request(new URL('/percy/pdf/snapshot', percy.address()), { method: 'POST', body }, true);
  }

  beforeAll(async () => {
    jasmine.DEFAULT_TIMEOUT_INTERVAL = 240000;
    await import('@percy/cli-pdf');
  });

  beforeEach(async () => {
    jasmine.DEFAULT_TIMEOUT_INTERVAL = 240000;
    await setupTest({
      filesystem: {
        $bypass: [p => typeof p === 'string' && p.includes('pdfjs-dist')]
      }
    });
    percy = new Percy({ token: 'PERCY_TOKEN', port: 1337 });
    await percy.start();
  });

  afterEach(async () => {
    await percy.stop();
  });

  function settleSyncJobsImmediately() {
    spyOn(percy.syncQueue, 'push').and.callFake(job => job.resolve(job.id));
  }

  describe('request validation', () => {
    it('requires a name', async () => {
      let [body, res] = await postRaw({ pdf: { content: b64(buildPdf()) } });

      expect(res.statusCode).toBe(400);
      expect(body.error).toMatch(/Missing required `name`/);
    });

    it('requires a pdf object', async () => {
      let [body, res] = await postRaw({ name: 'doc' });

      expect(res.statusCode).toBe(400);
      expect(body.error).toMatch(/Missing required `pdf` object/);
    });

    it('requires pdf.content', async () => {
      let [body, res] = await postRaw({ name: 'doc', pdf: {} });

      expect(res.statusCode).toBe(400);
      expect(body.error).toMatch(/Missing required `pdf\.content`/);
    });

    it('rejects content that does not decode to a PDF', async () => {
      let [body, res] = await postRaw({
        name: 'doc',
        pdf: { content: b64(Buffer.from('not a pdf at all')) }
      });

      expect(res.statusCode).toBe(400);
      expect(body.error).toMatch(/missing %PDF- header/);
    });

    it('rejects a body that is not a JSON object', async () => {
      let [arrBody, arrRes] = await postRaw([1, 2]);
      expect(arrRes.statusCode).toBe(400);
      expect(arrBody.error).toMatch(/Expected a JSON object body/);

      let [strBody, strRes] = await postRaw('not json at all');
      expect(strRes.statusCode).toBe(400);
      expect(strBody.error).toMatch(/Expected a JSON object body/);
    });

    it('rejects an empty body', async () => {
      let [, res] = await postRaw(undefined);
      expect(res.statusCode).toBe(400);
    });

    it('rejects a non-object JSON body', async () => {
      let [body, res] = await postRaw(5);
      expect(res.statusCode).toBe(400);
      expect(body.error).toMatch(/Expected a JSON object body/);
    });

    it('rejects a blank name', async () => {
      let [body, res] = await postRaw({
        name: '   ',
        pdf: { content: b64(buildPdf()) }
      });

      expect(res.statusCode).toBe(400);
      expect(body.error).toMatch(/Missing required `name`/);
    });

    it('rejects an invalid scale', async () => {
      for (let scale of [0, 99, 'big']) {
        let [body, res] = await postRaw({
          name: 'doc',
          pdf: { content: b64(buildPdf()) },
          scale
        });

        expect(res.statusCode).toBe(400);
        expect(body.error).toMatch(/Invalid scale/);
      }
    });

    it('reports a browser failure as a rasterization error', async () => {
      spyOn(percy.browser, 'page').and.rejectWith(new Error('no page for you'));

      let [body, res] = await postRaw({
        name: 'doc',
        pdf: { content: b64(buildPdf()) }
      });

      expect(res.statusCode).toBe(400);
      expect(body.error).toMatch(/Could not rasterize PDF: no page for you/);
    });

    it('rejects an impossible page selection', async () => {
      let [body, res] = await postRaw({
        name: 'doc',
        pdf: { content: b64(buildPdf({ pageCount: 2 })) },
        pages: '5'
      });

      expect(res.statusCode).toBe(400);
      expect(body.error).toMatch(/Requested page 5 but the document has only 2 pages/);
    });

    it('warns but proceeds on an unrecognised option', async () => {
      await post({
        name: 'doc',
        pdf: { content: b64(buildPdf()) },
        someFutureOption: true
      });

      expect(logger.stderr).toContain(
        jasmine.stringContaining('Invalid PDF snapshot options:'));
    });
  });

  describe('decodePdf', () => {
    it('returns the decoded buffer', () => {
      let pdf = buildPdf();
      expect(decodePdf({ content: b64(pdf) }).equals(pdf)).toBe(true);
    });

    it('rejects a pdf value that is not an object', () => {
      expect(() => decodePdf('policy.pdf')).toThrowMatching(
        e => e.status === 400 && /Missing required `pdf` object/.test(e.message));
    });

    it('rejects empty content', () => {
      expect(() => decodePdf({ content: '' })).toThrowMatching(
        e => e.status === 400 && /Missing required `pdf\.content`/.test(e.message));
    });

    it('rejects content too short to be a PDF', () => {
      expect(() => decodePdf({ content: 'AA' })).toThrowMatching(
        e => e.status === 400 && /not valid base64-encoded data/.test(e.message));
    });

    it('rejects an oversized PDF', () => {
      let big = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(50 * 1024 * 1024)]);
      expect(() => decodePdf({ content: b64(big) })).toThrowMatching(
        e => e.status === 413 && /maximum size of 50MB/.test(e.message));
    });
  });

  describe('loadPdfModule', () => {
    it('resolves the optional package when present', async () => {
      await expectAsync(loadPdfModule()).toBeResolved();
    });

    it('explains how to install it when the import fails', async () => {
      let load = () => Promise.reject(new Error('MODULE_NOT_FOUND'));

      await expectAsync(loadPdfModule(load)).toBeRejectedWithError(
        /PDF snapshots require the @percy\/cli-pdf package, which is not installed/);
      await loadPdfModule(load).catch(e => expect(e.status).toBe(501));
    });
  });

  describe('page snapshot names', () => {
    it('matches the percy-pdf convention so baselines survive migration', () => {
      expect(pageSnapshotName('Policy', 1)).toBe('Policy | Page 1');
      expect(pageSnapshotName('Policy', 12)).toBe('Policy | Page 12');
    });
  });

  describe('fan-out', () => {
    it('creates one snapshot per page', async () => {
      let body = await post({
        name: 'doc',
        pdf: { content: b64(buildPdf({ pageCount: 3 })) }
      });

      expect(body.success).toBe(true);
      expect(body.data['page-count']).toBe(3);
      expect(body.data['pages-snapshotted']).toBe(3);
      expect(body.data.status).toBe('queued');
      expect(body.data.pages.map(p => p['snapshot-name'])).toEqual([
        'doc | Page 1', 'doc | Page 2', 'doc | Page 3'
      ]);

      await percy.idle();

      expect(logger.stdout).toContain('[percy] Snapshot taken: doc | Page 1');
      expect(logger.stdout).toContain('[percy] Snapshot taken: doc | Page 2');
      expect(logger.stdout).toContain('[percy] Snapshot taken: doc | Page 3');
    });

    it('honours pages and excludePages', async () => {
      let body = await post({
        name: 'doc',
        pdf: { content: b64(buildPdf({ pageCount: 5 })) },
        pages: '1-4',
        excludePages: [2]
      });

      expect(body.data['page-count']).toBe(5);
      expect(body.data.pages.map(p => p.page)).toEqual([1, 3, 4]);
    });

    it('reduces the scale when a page would exceed Percy limits', async () => {
      // US Legal: 612x1008pt would be 1224x2016px at scale 2, over the cap.
      let upload = spyOn(percy, 'upload').and.callThrough();

      await post({
        name: 'doc',
        pdf: { content: b64(buildPdf({ width: 612, height: 1008 })) },
        scale: 2
      });

      expect(logger.stderr).toContain(
        jasmine.stringContaining('scale reduced from 2'));

      let [options] = upload.calls.first().args;
      expect(options.minHeight).toBeLessThanOrEqual(2000);
    });

    it('sizes each snapshot from its own raster', async () => {
      let upload = spyOn(percy, 'upload').and.callThrough();

      await post({
        name: 'doc',
        pdf: { content: b64(buildPdf({ width: 200, height: 300 })) },
        scale: 2
      });

      let [options] = upload.calls.first().args;
      expect(options.widths).toEqual([400]);
      expect(options.minHeight).toBe(600);
    });

    it('lets the caller override widths and minHeight', async () => {
      let upload = spyOn(percy, 'upload').and.callThrough();

      await post({
        name: 'doc',
        pdf: { content: b64(buildPdf()) },
        widths: [800],
        minHeight: 1000
      });

      let [options] = upload.calls.first().args;
      expect(options.widths).toEqual([800]);
      expect(options.minHeight).toBe(1000);
    });

    it('attaches a root DOM whose img src matches the image resource', async () => {
      let upload = spyOn(percy, 'upload').and.callThrough();

      await post({
        name: 'my doc',
        pdf: { content: b64(buildPdf()) }
      });

      let [options] = upload.calls.first().args;
      let resources = await options.resources();
      let root = resources.find(r => r.root);
      let image = resources.find(r => r.mimetype === 'image/png');

      expect(root.mimetype).toBe('text/html');
      expect(image.content.subarray(0, 8))
        .toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));

      let src = /<img\s+src="([^"]+)"/.exec(root.content)[1];
      expect(src).toBe(image.url);
    });

    it('gives each page a distinct image resource', async () => {
      let upload = spyOn(percy, 'upload').and.callThrough();

      await post({
        name: 'doc',
        pdf: { content: b64(buildPdf({ pageCount: 3 })) }
      });

      let shas = [];
      for (let call of upload.calls.all()) {
        let resources = await call.args[0].resources();
        shas.push(resources.find(r => r.mimetype === 'image/png').sha);
      }

      expect(new Set(shas).size).toBe(3);
    });

    it('creates web snapshots, not comparisons', async () => {
      let upload = spyOn(percy, 'upload').and.callThrough();

      await post({ name: 'doc', pdf: { content: b64(buildPdf()) } });

      let [options] = upload.calls.first().args;
      expect(options.tag).toBeUndefined();
      expect(options.tiles).toBeUndefined();
    });
  });

  describe('sync mode', () => {
    it('returns an aggregate object with one entry per page', async () => {
      settleSyncJobsImmediately();
      spyOn(percy.client, 'getSnapshotDetails').and.callFake(async id => ({
        'snapshot-name': `snapshot-${id}`,
        status: 'success',
        screenshots: [{ 'diff-info': { 'diff-ratio': 0 } }]
      }));

      let body = await post({
        name: 'doc',
        sync: true,
        pdf: { content: b64(buildPdf({ pageCount: 2 })) }
      });

      expect(Array.isArray(body.data)).toBe(false);
      expect(body.data['pdf-name']).toBe('doc');
      expect(body.data['page-count']).toBe(2);
      expect(body.data.status).toBe('success');
      expect(body.data.pages.length).toBe(2);
      expect(body.data.pages[0].page).toBe(1);
      expect(body.data.pages[0]['snapshot-name']).toBe('doc | Page 1');
      expect(body.data.pages[1]['snapshot-name']).toBe('doc | Page 2');
      expect(body.data.pages[0].screenshots[0]['diff-info']['diff-ratio']).toBe(0);
      expect(percy.client.getSnapshotDetails).toHaveBeenCalledTimes(2);
    });

    it('reports failure when any page fails', async () => {
      settleSyncJobsImmediately();
      let calls = 0;
      spyOn(percy.client, 'getSnapshotDetails').and.callFake(async () => {
        return ++calls === 2
          ? Promise.reject(new Error('snapshot blew up'))
          : { status: 'success', screenshots: [{ 'diff-info': { 'diff-ratio': 0 } }] };
      });

      let body = await post({
        name: 'doc',
        sync: true,
        pdf: { content: b64(buildPdf({ pageCount: 3 })) }
      });

      expect(body.data.status).toBe('failure');
      expect(body.data.pages.length).toBe(3);
      expect(body.data.pages[1].error).toBe('snapshot blew up');
      expect(body.data.pages[0].status).toBe('success');
      expect(body.data.pages[2].status).toBe('success');
    });

    it('reports failure when a page comes back with a failure status', async () => {
      settleSyncJobsImmediately();
      spyOn(percy.client, 'getSnapshotDetails').and.callFake(async () => ({
        status: 'failure',
        screenshots: []
      }));

      let body = await post({
        name: 'doc',
        sync: true,
        pdf: { content: b64(buildPdf()) }
      });

      expect(body.data.status).toBe('failure');
    });

    it('does not wait when sync is not requested', async () => {
      spyOn(percy.client, 'getSnapshotDetails');

      let body = await post({ name: 'doc', pdf: { content: b64(buildPdf()) } });

      expect(body.data.status).toBe('queued');
      expect(percy.client.getSnapshotDetails).not.toHaveBeenCalled();
    });
  });
});
