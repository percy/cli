import fs from 'fs';
import path from 'path';
import { pdfjsAssets } from '../src/assets.js';

describe('@percy/cli-pdf assets', () => {
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
});
