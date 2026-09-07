// Generates the root DOM for a single rasterized PDF page.
//
// Modelled on cli-upload's getImageResources: a minimal document that displays
// one image at its native size with no margins, padding or font metrics that
// could shift between renders. Anything more elaborate here becomes a source of
// diffs unrelated to the PDF itself.

// `title` is user-controlled (it is the snapshot name) and lands inside
// <title>, so it must be escaped -- an unescaped `</title><script>` would
// otherwise be injected into the DOM that Percy's renderer loads.
//
// `imageUrl` gets the same treatment and NOTHING MORE. It arrives already
// percent-encoded from the caller, so running encodeURI over it turns `%20`
// into `%2520`: the <img src> then no longer matches the URL the image resource
// was registered under, every page renders as the same blank sheet, and all
// pages collapse to one identical image hash -- which silently reports zero
// diffs for documents that genuinely changed. HTML-escaping only, as
// cli-upload's getImageResources does.
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
