import path from 'path';
import { createRequire } from 'module';

const cjsRequire = createRequire(import.meta.url);

export function pdfjsAssets() {
  let root = path.dirname(cjsRequire.resolve('pdfjs-dist/package.json'));
  let buildDir = path.join(root, 'legacy/build');

  return {
    root,
    buildDir,
    standardFontsDir: path.join(root, 'standard_fonts'),
    cmapsDir: path.join(root, 'cmaps'),
    // pdfjs-dist v4 ships ESM only -- there is no UMD bundle left to read off
    // disk and eval, so the library and its worker are loaded as modules over
    // the asset server instead (see loadLibrary in browser-scripts.js).
    libFile: 'pdf.mjs',
    libPath: path.join(buildDir, 'pdf.mjs'),
    workerFile: 'pdf.worker.mjs'
  };
}
