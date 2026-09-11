// Track P — PDF rasterization byte comparison (token-free).
//
// Renders the PDFs in `assets/pdfs/` through the real rasterization path
// (@percy/core's `rasterizePdf` — pdf.js driven in the discovery browser, the
// same code `POST /percy/pdf/snapshot` calls) and compares every produced PNG
// byte-for-byte against a committed golden in `assets/pdfs/expected/`.
//
// Byte equality is the assertion because it catches anything that changes what
// reaches Percy — scale selection, canvas size, pixel output, PNG encoding —
// including drift a visual diff would wave through as "close enough".
//
// Two caveats the mechanism has to account for, both measured rather than
// assumed (see TOLERANCES below):
//
//   1. PNG bytes come out of Chromium's canvas encoder, so goldens are only
//      reproducible on the platform and Chromium build that produced them.
//      Goldens therefore live under `expected/<platform>-<arch>/`, each set with
//      its own `manifest.json` recording the browser build it came from. CI
//      (linux-x64) and a macOS dev machine each compare against their own set.
//   2. Pages containing raster images are not byte-reproducible even on one
//      machine: Chromium picks between two anti-aliasing paths for a clipped
//      image edge from run to run. Those pages declare a measured pixel budget
//      and fail if the difference exceeds it.
//
// Run:            yarn test:regression:pdf
// Regenerate:     yarn test:regression:pdf --update
//                 (or UPDATE_PDF_GOLDENS=1 yarn test:regression:pdf, for
//                 runners that swallow trailing args)
//
// Adding a PDF: drop it in `assets/pdfs/` and regenerate — no test changes.

import fs from 'fs';
import path from 'path';
import {
  comparePngs, createPercy, goldenDir, goldenPath, knownPlatforms, listPdfs,
  manifestPath, platformKey, readManifest, renderEnvironment, renderPdf, sha256,
  slugify
} from './lib/pdf-render.js';

const UPDATE = process.argv.includes('--update') || process.env.UPDATE_PDF_GOLDENS === '1';

// Per-asset allowance for pages that cannot be byte-reproducible. Everything
// not listed here must match byte-for-byte; these budgets are the only escape
// hatch, and they are deliberately tight.
//
// `jack sparrow resume.pdf` embeds a photo clipped to a circle. Chromium
// rasterizes that clip edge one of two ways depending on how the decoded image
// lands, so ~6 runs in 15 differ from the golden — always the same 270 pixels
// in the same 193x193 box around the photo, never more than 52 per channel, out
// of 2,005,644 pixels (0.013%). The budget is ~2x the measured worst case: a
// real rendering regression moves glyphs or layout and blows straight past it.
const TOLERANCES = {
  'jack-sparrow-resume': {
    maxDiffPixels: 600,
    maxChannelDelta: 96,
    reason: 'Chromium anti-aliases the circular photo clip differently between runs'
  }
};

// Byte offset of the first difference, or -1 when the buffers are identical.
function firstDiff(a, b) {
  let len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) if (a[i] !== b[i]) return i;
  return a.length === b.length ? -1 : len;
}

async function run() {
  console.log(`Track P — PDF rasterization byte comparison${UPDATE ? ' (UPDATING GOLDENS)' : ''}\n`);

  let platform = platformKey();
  let dir = goldenDir(platform);
  let pdfs = listPdfs();

  console.log(`Platform ${platform}; goldens in ${path.relative(process.cwd(), dir)}\n`);

  if (!pdfs.length) {
    console.error('No PDFs found in test/regression/assets/pdfs');
    process.exit(1);
  }

  if (!UPDATE && !fs.existsSync(dir)) {
    console.error(
      `No goldens committed for ${platform} (have: ${knownPlatforms().join(', ') || 'none'}).\n` +
      'Generate them on this platform with --update and commit the result.'
    );
    process.exit(1);
  }

  let failures = 0;
  let tolerated = 0;

  const pass = msg => console.log(`  ✓ ${msg}`);
  const fail = msg => { failures++; console.error(`  ✗ ${msg}`); };
  const warn = msg => { tolerated++; console.log(`  ~ ${msg}`); };

  let manifest = readManifest(platform);
  let percy = createPercy();
  let entries = {};
  let pending = [];
  let env;

  try {
    for (let pdf of pdfs) {
      let slug = slugify(pdf);
      let tolerance = TOLERANCES[slug];
      console.log(`${pdf} (${slug})${tolerance ? ' [tolerance declared]' : ''}`);

      let { pageCount, scale, pages } = await renderPdf(percy, pdf);
      if (!env) env = renderEnvironment(percy);

      if (pages.length === pageCount) {
        pass(`rendered every page (${pages.length} of ${pageCount})`);
      } else {
        fail(`rendered ${pages.length} of ${pageCount} page(s)`);
      }

      entries[slug] = {
        source: pdf,
        'page-count': pageCount,
        scale,
        pages: pages.map(({ page, width, height, png }) => ({
          page, width, height, bytes: png.length, sha256: sha256(png)
        }))
      };

      for (let { page, width, height, png } of pages) {
        let golden = goldenPath(slug, page);
        let rel = path.relative(process.cwd(), golden);

        if (UPDATE) {
          // Buffered, not written yet: nothing lands on disk until every page
          // has rendered cleanly (see the failure check after the loop).
          pending.push({ golden, rel, png, width, height });
          continue;
        }

        if (!fs.existsSync(golden)) {
          fail(`page ${page}: missing golden ${rel} — run with --update to create it`);
          continue;
        }

        let expected = fs.readFileSync(golden);
        let offset = firstDiff(expected, png);

        if (offset === -1) {
          pass(`page ${page}: ${png.length} bytes identical (${width}x${height})`);
          continue;
        }

        let detail =
          `first differing byte at offset ${offset} ` +
          `(expected ${expected.length} bytes / ${sha256(expected).slice(0, 12)}, ` +
          `got ${png.length} bytes / ${sha256(png).slice(0, 12)})`;

        if (!tolerance) {
          fail(`page ${page}: PNG differs from ${rel} — ${detail}`);
          continue;
        }

        // Declared tolerance: the bytes differ, so fall back to comparing what
        // the pixels actually do and hold it to the measured budget.
        let diff = await comparePngs(percy, expected, png);

        if (diff.sizeMismatch) {
          fail(
            `page ${page}: golden is ${diff.expected.width}x${diff.expected.height}, ` +
            `rendered ${diff.actual.width}x${diff.actual.height} — size changes are never tolerated`
          );
        } else if (diff.diffPixels > tolerance.maxDiffPixels ||
                   diff.maxChannelDelta > tolerance.maxChannelDelta) {
          fail(
            `page ${page}: PNG differs beyond the declared tolerance — ` +
            `${diff.diffPixels} pixels (max ${tolerance.maxDiffPixels}), ` +
            `channel delta ${diff.maxChannelDelta} (max ${tolerance.maxChannelDelta}), ` +
            `box [${diff.box?.join(', ')}]; ${detail}`
          );
        } else {
          warn(
            `page ${page}: bytes differ but within tolerance — ` +
            `${diff.diffPixels}/${diff.totalPixels} pixels, channel delta ` +
            `${diff.maxChannelDelta}, box [${diff.box?.join(', ')}] (${tolerance.reason})`
          );
        }
      }

      console.log('');
    }
  } finally {
    await percy.browser.close();
  }

  if (UPDATE) {
    // A render that failed its own sanity checks (a page that never rendered,
    // say) must not become the baseline — that would bake the failure into the
    // goldens and every later run would agree with it. Nothing has touched disk
    // yet, so bailing here leaves the committed set intact.
    if (failures) {
      console.error(
        `\nTRACK P FAILED: ${failures} assertion(s) failed while rendering; ` +
        'no goldens or manifest were written'
      );
      process.exit(1);
    }

    fs.mkdirSync(dir, { recursive: true });

    for (let { golden, rel, png, width, height } of pending) {
      fs.writeFileSync(golden, png);
      console.log(`  ↻ wrote ${rel} (${width}x${height}, ${png.length} bytes)`);
    }

    fs.writeFileSync(manifestPath(platform), JSON.stringify({
      generated: new Date().toISOString(),
      ...env,
      pdfs: entries
    }, null, 2) + '\n');
    console.log(
      `Wrote ${path.relative(process.cwd(), manifestPath(platform))} ` +
      `for ${env.platform} / ${env.browser}`
    );
    console.log('\nTRACK P GOLDENS UPDATED');
    process.exit(0);
  }

  // Only reported alongside a failure: the goldens are already platform-scoped,
  // so this catches the remaining environmental cause — a Chromium bump since
  // the set was recorded.
  if (failures && manifest && env && manifest.browser !== env.browser) {
    console.error(
      `\nNOTE: these goldens were recorded on ${manifest.browser}; this run is ` +
      `${env.browser}. PNG bytes are only reproducible for a given Chromium build — ` +
      'regenerate with --update if the difference is the browser bump rather than a ' +
      'rendering regression.'
    );
  }

  if (failures) {
    console.error(`\nTRACK P FAILED: ${failures} assertion(s) failed`);
    process.exit(1);
  }

  console.log(`TRACK P PASSED${tolerated ? ` (${tolerated} page(s) matched within tolerance)` : ''}`);
  process.exit(0);
}

run().catch(err => {
  console.error('PDF regression runner error:', err);
  process.exit(1);
});
