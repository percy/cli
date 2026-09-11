// Shared PDF rasterization helper for the byte-comparison regression track.
//
// Drives the SAME code path the `/percy/pdf/snapshot` endpoint uses —
// `rasterizePdf` from @percy/core, which serves pdf.js out of a local asset
// server and renders each page in the discovery browser. The endpoint only
// wraps the PNGs these calls produce into snapshot resources, so rendering
// here exercises everything that decides what the PNG bytes look like.
//
// Core is imported from `dist/` — the built output CI links and the code that
// actually ships — so the track asserts on what users get, not on untranspiled
// source. Run `yarn build` before running this locally.

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Percy from '@percy/core';
import { rasterizePdf } from '../../../packages/core/dist/pdf-rasterize.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const PDF_DIR = path.join(__dirname, '..', 'assets', 'pdfs');
export const GOLDEN_ROOT = path.join(PDF_DIR, 'expected');

// Goldens are per-platform. PNG bytes come out of Chromium's canvas encoder, so
// a set recorded on macOS/arm64 does not reproduce on the Linux CI runner --
// keeping them in separate directories lets both be committed and lets a run
// compare against its own platform instead of failing on a foreign baseline.
export function platformKey() {
  return `${process.platform}-${process.arch}`;
}

export function goldenDir(platform = platformKey()) {
  return path.join(GOLDEN_ROOT, platform);
}

export function manifestPath(platform = platformKey()) {
  return path.join(goldenDir(platform), 'manifest.json');
}

// `jack sparrow resume.pdf` -> `jack-sparrow-resume`
export function slugify(pdfFilename) {
  return path.basename(pdfFilename, '.pdf')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

export function goldenPath(slug, pageNumber, platform = platformKey()) {
  return path.join(goldenDir(platform), `${slug}-page-${pageNumber}.png`);
}

export function listPdfs() {
  return fs.readdirSync(PDF_DIR)
    .filter(f => f.toLowerCase().endsWith('.pdf'))
    .sort();
}

export function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

// A Percy instance is needed only for its discovery browser — skipUploads and
// skipDiscovery keep it from creating a build or touching the network, so this
// track stays token-free.
export function createPercy() {
  return new Percy({ token: 'regression-pdf', skipUploads: true, skipDiscovery: true });
}

// Renders every page of one PDF at default scale, returning the rasterizer's
// own page records ({ page, width, height, scale, png }).
export async function renderPdf(percy, pdfFilename, options = {}) {
  let buffer = await fs.promises.readFile(path.join(PDF_DIR, pdfFilename));
  return rasterizePdf(percy, buffer, options);
}

// Identifies what produced a set of goldens. PNG bytes come out of Chromium's
// canvas encoder, so they are reproducible for a given browser build but not
// guaranteed identical across platforms or Chromium revisions — recording this
// turns "the goldens are stale" into a readable failure instead of a mystery.
export function renderEnvironment(percy) {
  return {
    platform: platformKey(),
    browser: (percy.browser.version && percy.browser.version.product) || 'unknown'
  };
}

export function readManifest(platform = platformKey()) {
  let file = manifestPath(platform);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf-8'));
}

// Which platforms already have a committed golden set.
export function knownPlatforms() {
  if (!fs.existsSync(GOLDEN_ROOT)) return [];
  return fs.readdirSync(GOLDEN_ROOT, { withFileTypes: true })
    .filter(e => e.isDirectory())
    .map(e => e.name)
    .sort();
}

// Decodes two PNGs in the browser and reports how they differ. Only used when
// the byte comparison fails: `diffPixels`/`maxChannelDelta` turn "the bytes
// changed" into "and here is how much of the image actually moved", which is
// what distinguishes rasterizer jitter from a rendering regression.
export async function comparePngs(percy, expected, actual) {
  await percy.browser.launch();
  let page = await percy.browser.page({ meta: { snapshot: { name: 'pdf-compare' } } });

  try {
    await page.goto('about:blank');

    return await page.eval(async (_, { a, b }) => {
      const load = src => new Promise((resolve, reject) => {
        /* eslint-disable-next-line no-undef */
        let img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('could not decode PNG'));
        img.src = src;
      });

      const pixels = img => {
        let canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        let ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        return ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      };

      let [ia, ib] = await Promise.all([load(a), load(b)]);

      if (ia.width !== ib.width || ia.height !== ib.height) {
        return {
          sizeMismatch: true,
          expected: { width: ia.width, height: ia.height },
          actual: { width: ib.width, height: ib.height }
        };
      }

      let da = pixels(ia);
      let db = pixels(ib);
      let diffPixels = 0;
      let maxChannelDelta = 0;
      let box = null;

      for (let i = 0; i < da.length; i += 4) {
        let delta = Math.max(
          Math.abs(da[i] - db[i]), Math.abs(da[i + 1] - db[i + 1]),
          Math.abs(da[i + 2] - db[i + 2]), Math.abs(da[i + 3] - db[i + 3])
        );

        if (!delta) continue;

        diffPixels++;
        if (delta > maxChannelDelta) maxChannelDelta = delta;

        let x = (i / 4) % ia.width;
        let y = Math.floor((i / 4) / ia.width);
        box = box
          ? [Math.min(box[0], x), Math.min(box[1], y), Math.max(box[2], x), Math.max(box[3], y)]
          : [x, y, x, y];
      }

      return {
        sizeMismatch: false,
        width: ia.width,
        height: ia.height,
        totalPixels: da.length / 4,
        diffPixels,
        maxChannelDelta,
        box
      };
    }, {
      a: `data:image/png;base64,${expected.toString('base64')}`,
      b: `data:image/png;base64,${actual.toString('base64')}`
    });
  } finally {
    await page.close();
  }
}
