import fs from 'fs';
import path from 'path';
import stream from 'stream';
import { promisify } from 'util';
import yauzl from 'yauzl';

const pipeline = promisify(stream.pipeline);
const openZip = promisify(yauzl.open);

// stat mode constants for entry external file attributes
const IFMT = 0o170000;
const IFDIR = 0o040000;
const IFLNK = 0o120000;

// Returns the file mode of an extracted entry, with defaults matching the
// previous extract-zip behavior when the archive does not provide one
function extractedMode(mode, isDir) {
  return (mode || (isDir ? 0o755 : 0o644)) & 0o777;
}

// Collects a readable stream into a utf8 string (symlink targets)
async function readAll(readable) {
  let chunks = [];
  for await (let chunk of readable) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

// Extracts a zip archive into a directory, preserving file modes, directory
// entries, and symlinks. Replaces the unmaintained extract-zip package, whose
// yauzl@2 dependency deadlocks on deflate entries under Node 26
// (https://github.com/thejoshwolfe/yauzl/issues/176).
export default async function unzip(archive, { dir }) {
  if (!path.isAbsolute(dir)) {
    throw new Error('Target directory is expected to be absolute');
  }

  await fs.promises.mkdir(dir, { recursive: true });
  dir = await fs.promises.realpath(dir);

  let zipfile = await openZip(archive, { lazyEntries: true, autoClose: false });
  let openReadStream = promisify(zipfile.openReadStream.bind(zipfile));

  try {
    await new Promise((resolve, reject) => {
      let done = false;
      let finish = err => {
        if (done) return;
        done = true;
        if (err) reject(err); else resolve();
      };

      zipfile.on('error', finish);
      zipfile.on('end', () => finish());

      zipfile.on('entry', async entry => {
        try {
          // skip macOS resource fork entries
          if (entry.fileName.startsWith('__MACOSX/')) {
            return zipfile.readEntry();
          }

          // strip any leading traversal segments before joining (zip-slip)
          let fileName = entry.fileName.replace(/^(\.\.(\/|\\|$))+/, '');
          // `dir` is the trusted install target from install.js, not user input,
          // and `fileName` is sanitized above with the traversal guard below
          // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
          let dest = path.join(dir, fileName);

          // guard against zip-slip for any remaining traversal
          if (path.relative(dir, dest).split(path.sep).includes('..')) {
            throw new Error(`Out of bound path "${dest}" found while processing file ${entry.fileName}`);
          }

          let mode = (entry.externalFileAttributes >> 16) & 0xFFFF;
          let isSymlink = (mode & IFMT) === IFLNK;
          let isDir = (mode & IFMT) === IFDIR ||
            entry.fileName.endsWith('/') ||
            // directories from some windows archivers lack mode bits
            ((entry.versionMadeBy >> 8) === 0 && entry.externalFileAttributes === 16);

          if (isDir) {
            await fs.promises.mkdir(dest, { recursive: true, mode: extractedMode(mode, true) });
          } else {
            await fs.promises.mkdir(path.dirname(dest), { recursive: true });
            let contents = await openReadStream(entry);

            if (isSymlink) {
              await fs.promises.symlink(await readAll(contents), dest);
            } else {
              await pipeline(contents, fs.createWriteStream(dest, { mode: extractedMode(mode, false) }));
            }
          }

          zipfile.readEntry();
        } catch (error) {
          finish(error);
        }
      });

      zipfile.readEntry();
    });
  } finally {
    zipfile.close();
  }
}
