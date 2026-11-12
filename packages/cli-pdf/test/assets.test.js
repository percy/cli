import fs from 'fs';
import os from 'os';
import path from 'path';
import { createRequire } from 'module';
import { pdfjsAssets } from '../src/assets.js';
import { vendorPdfjs } from '../scripts/vendor-pdfjs.js';

const pdfjsRoot = path.dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json'));

describe('@percy/cli-pdf assets', () => {
  // the source checkout has no dist/pdfjs, so this resolves pdfjs-dist
  let assets = pdfjsAssets();

  it('resolves the installed pdfjs-dist root', () => {
    expect(fs.existsSync(path.join(assets.root, 'package.json'))).toBe(true);
  });

  it('points at the legacy build directory', () => {
    expect(fs.existsSync(assets.buildDir)).toBe(true);
    expect(fs.existsSync(path.join(assets.buildDir, assets.libFile))).toBe(true);
    expect(fs.existsSync(path.join(assets.buildDir, assets.workerFile))).toBe(true);
  });

  it('points at the font and cmap data pdf.js fetches at runtime', () => {
    expect(fs.existsSync(assets.standardFontsDir)).toBe(true);
    expect(fs.existsSync(assets.cmapsDir)).toBe(true);
    expect(fs.readdirSync(assets.standardFontsDir).length).toBeGreaterThan(0);
    expect(fs.readdirSync(assets.cmapsDir).length).toBeGreaterThan(0);
  });

  it('names the ES module entry and worker the page loads', () => {
    // pdf.js 4+ only ships ES modules; the page imports the library and pdf.js
    // spawns the worker as a module worker, so both must be .mjs files
    expect(assets.libFile).toMatch(/\.mjs$/);
    expect(assets.workerFile).toMatch(/\.mjs$/);

    let lib = fs.readFileSync(path.join(assets.buildDir, assets.libFile), 'utf-8');
    expect(lib).toContain('getDocument');
    expect(lib).toContain('globalThis.pdfjsLib');
  });

  describe('when pdf.js is vendored into the package', () => {
    let tmp, vendored;

    beforeAll(() => {
      tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'percy-pdfjs-'));
      // run twice to cover replacing an earlier copy
      vendorPdfjs(path.join(tmp, 'pdfjs'));
      vendored = pdfjsAssets({ vendoredDir: vendorPdfjs(path.join(tmp, 'pdfjs')) });
    });

    afterAll(() => {
      (fs.rmSync || fs.rmdirSync)(tmp, { recursive: true, force: true });
    });

    it('prefers the vendored copy over the pdfjs-dist dependency', () => {
      expect(vendored.root).toEqual(path.join(tmp, 'pdfjs'));
      expect(assets.root).toEqual(pdfjsRoot);
    });

    it('carries every file the page loads, unchanged', () => {
      for (let file of [vendored.libFile, vendored.workerFile]) {
        expect(fs.readFileSync(path.join(vendored.buildDir, file)))
          .toEqual(fs.readFileSync(path.join(assets.buildDir, file)));
      }
      expect(fs.readdirSync(vendored.standardFontsDir)).toEqual(fs.readdirSync(assets.standardFontsDir));
      expect(fs.readdirSync(vendored.cmapsDir)).toEqual(fs.readdirSync(assets.cmapsDir));
      expect(fs.existsSync(path.join(vendored.root, 'LICENSE'))).toBe(true);
    });
  });
});
