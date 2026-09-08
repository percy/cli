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
    expect(fs.existsSync(path.join(assets.buildDir, 'pdf.js'))).toBe(true);
    expect(fs.existsSync(path.join(assets.buildDir, assets.workerFile))).toBe(true);
  });

  it('points at the font and cmap data pdf.js fetches at runtime', () => {
    expect(fs.existsSync(assets.standardFontsDir)).toBe(true);
    expect(fs.existsSync(assets.cmapsDir)).toBe(true);
    expect(fs.readdirSync(assets.standardFontsDir).length).toBeGreaterThan(0);
    expect(fs.readdirSync(assets.cmapsDir).length).toBeGreaterThan(0);
  });

  it('exposes the injectable pdf.js library file', () => {
    expect(fs.existsSync(assets.libPath)).toBe(true);
    expect(fs.readFileSync(assets.libPath, 'utf-8')).toContain('getDocument');
  });
});
