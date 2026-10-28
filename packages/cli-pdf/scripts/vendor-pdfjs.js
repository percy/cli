import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

// pdf.js only runs inside the browser, served from a loopback asset server, so
// the files it needs are copied into dist at build time. That keeps pdfjs-dist,
// which declares node >=20 and pulls in a native canvas package, out of installs.
const FILES = [
  'package.json',
  'LICENSE',
  'legacy/build/pdf.mjs',
  'legacy/build/pdf.worker.mjs',
  'standard_fonts',
  'cmaps'
];

// fs.cpSync needs Node 16.7, the build still runs on Node 14
function copy(from, to) {
  if (fs.statSync(from).isDirectory()) {
    fs.mkdirSync(to, { recursive: true });
    for (let name of fs.readdirSync(from)) copy(path.join(from, name), path.join(to, name));
  } else {
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to);
  }
}

export function vendorPdfjs(outDir, root = path.dirname(
  createRequire(import.meta.url).resolve('pdfjs-dist/package.json'))
) {
  if (fs.existsSync(outDir)) (fs.rmSync || fs.rmdirSync)(outDir, { recursive: true, force: true });
  for (let file of FILES) copy(path.join(root, file), path.join(outDir, file));
  return outDir;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  vendorPdfjs(fileURLToPath(new URL('../dist/pdfjs', import.meta.url)));
}
