import path from 'path';
import { createRequire } from 'module';

const cjsRequire = createRequire(import.meta.url);

// pdfjs-dist v4 declares Node >=18 while the CLI supports Node >=14, so it is an
// optionalDependency and the resolve is deferred to call time — importing this
// module never throws on older Node versions (or when the optional install was
// skipped for any other reason). Mirrors how cli-command loads the snyk parser.
/* istanbul ignore next: pdfjs-backed path — the renderer requires Node >=18
   while CI runs the suite on Node 14, so exactly one of these branches is
   unreachable on any given run; both are exercised by the describePdfjs tests
   on Node >=18 and by the skipped-install spec on Node 14 */
export function pdfjsAssets() {
  let root;

  try {
    root = path.dirname(cjsRequire.resolve('pdfjs-dist/package.json'));
  } catch (e) {
    let err = new Error(`pdfjs-dist is not available (requires Node >=18, or the optional install was skipped): ${e.message}`);
    err.code = 'PDFJS_UNAVAILABLE';
    throw err;
  }

  let buildDir = path.join(root, 'legacy/build');

  return {
    root,
    buildDir,
    standardFontsDir: path.join(root, 'standard_fonts'),
    cmapsDir: path.join(root, 'cmaps'),
    // v4 ships ESM only -- there is no UMD bundle left to read off disk and
    // eval, so the library and its worker are loaded as modules over the asset
    // server instead (see loadLibrary in browser-scripts.js).
    libFile: 'pdf.mjs',
    libPath: path.join(buildDir, 'pdf.mjs'),
    workerFile: 'pdf.worker.mjs'
  };
}
