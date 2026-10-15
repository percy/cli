import path from 'path';
import { createRequire } from 'module';

const cjsRequire = createRequire(import.meta.url);

export function pdfjsAssets() {
  let root = path.dirname(cjsRequire.resolve('pdfjs-dist/package.json'));

  // pdf.js 4+ is published only as ES modules. The page imports `libFile` from
  // the loopback asset server that serves `buildDir` (see loadLibrary), and
  // pdf.js then spawns `workerFile` as a module worker from the same directory.
  return {
    root,
    buildDir: path.join(root, 'legacy/build'),
    standardFontsDir: path.join(root, 'standard_fonts'),
    cmapsDir: path.join(root, 'cmaps'),
    libFile: 'pdf.mjs',
    workerFile: 'pdf.worker.mjs'
  };
}
