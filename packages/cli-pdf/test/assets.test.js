import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { pdfjsAssets } from '../src/assets.js';

const cjsRequire = createRequire(import.meta.url);

// pdfjs-dist is an optionalDependency needing Node >=18; on Node 14 the install
// is skipped, so there are no assets to point at and only the throw is testable.
function pdfjsInstalled() {
  try {
    cjsRequire.resolve('pdfjs-dist/package.json');
    return true;
  } catch {
    return false;
  }
}

const installed = pdfjsInstalled();
const describePdfjs = installed ? describe : xdescribe;
const describeWithout = installed ? xdescribe : describe;

describeWithout('@percy/cli-pdf assets without pdfjs-dist', () => {
  it('throws a tagged error naming the Node requirement', () => {
    expect(() => pdfjsAssets()).toThrowError(/pdfjs-dist is not available \(requires Node >=18/);

    try {
      pdfjsAssets();
    } catch (error) {
      expect(error.code).toBe('PDFJS_UNAVAILABLE');
    }
  });
});

describePdfjs('@percy/cli-pdf assets', () => {
  let assets = installed ? pdfjsAssets() : {};

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

  it('exposes the importable pdf.js module', () => {
    expect(assets.libFile).toBe('pdf.mjs');
    expect(assets.workerFile).toBe('pdf.worker.mjs');
    expect(fs.existsSync(assets.libPath)).toBe(true);
    expect(fs.readFileSync(assets.libPath, 'utf-8')).toContain('getDocument');
  });
});
