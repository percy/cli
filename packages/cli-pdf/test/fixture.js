// Builds small real PDFs at test time rather than committing binaries.
//
// pdf-lib is not a dependency of this package (it is a devDependency of the
// monorepo root only through here), so the generator is hand-rolled: these are
// the minimum valid PDFs that pdf.js will parse. Keeping them literal also
// makes the "what exactly is on the page" question answerable by reading.

// A single-page PDF, `pageCount` pages, each drawing a filled rectangle whose
// size varies per page so pages rasterize to visibly different images.
export function buildPdf({ pageCount = 1, width = 200, height = 300 } = {}) {
  let objects = [];
  let pageIds = [];

  // 1: catalog, 2: pages tree; page objects start at 3
  for (let i = 0; i < pageCount; i++) {
    pageIds.push(3 + i * 2);
  }

  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map(id => `${id} 0 R`).join(' ')}] /Count ${pageCount} >>`;

  for (let i = 0; i < pageCount; i++) {
    let pageId = pageIds[i];
    let contentId = pageId + 1;
    // vary the drawn box per page
    let inset = 10 + i * 15;
    let stream = `${inset} ${inset} ${width - inset * 2} ${height - inset * 2} re f`;

    objects[pageId] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] ` +
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

export const NOT_A_PDF = Buffer.from('this is definitely not a pdf', 'utf8');
