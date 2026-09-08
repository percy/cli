function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function buildPageHtml({ title, imageUrl, width, height }) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <title>${escapeHtml(title)}</title>
    <style>
      *, *::before, *::after { margin: 0; padding: 0; font-size: 0; }
      html, body { width: 100%; background: #fff; }
      img { display: block; max-width: 100%; }
    </style>
  </head>
  <body>
    <img src="${escapeHtml(imageUrl)}" width="${width}px" height="${height}px" alt="">
  </body>
</html>`;
}

export { escapeHtml as _escapeHtml };
