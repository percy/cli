import path from 'path';
import https from 'https';
import {
  promises as fs,
  existsSync,
  createWriteStream
} from 'fs';
import rimraf from 'rimraf';
import log from '@percy/logger';
import readableBytes from './bytes';

// used to determine platform defaults
/* istanbul ignore next: hard to cover sans combined reports */
const platform = (
  process.platform === 'win32' && process.arch === 'x64'
    ? 'win64' : process.platform
);

export default async function install({
  // default discovery browser is chromium
  browser = 'Chromium',
  // default chromium version is 78.0.3904.x
  revision = platform === 'win64' ? /* istanbul ignore next */ '693951' : '693954',
  // default download directory is in @percy/core root
  directory = path.resolve(__dirname, '../../.local-chromium'),
  // default download url is dependent on platform and revision
  url = `https://storage.googleapis.com/chromium-browser-snapshots/${{
    linux: `Linux_x64/${revision}/chrome-linux.zip`,
    darwin: `Mac/${revision}/chrome-mac.zip`,
    win64: `Win_x64/${revision}/chrome-win.zip`,
    win32: `Win/${revision}/chrome-win32.zip`
  }[platform]}`,
  // default extraction method is to unzip
  extract = (i, o) => require('extract-zip')(i, { dir: o }),
  // default exectuable location within the extracted archive
  executable = {
    linux: 'chrome',
    win64: 'chrome.exe',
    win32: 'chrome.exe',
    darwin: path.join('Chromium.app', 'Contents', 'MacOS', 'Chromium')
  }[platform]
} = {}) {
  let outdir = path.join(directory, revision);
  let dlpath = path.join(outdir, decodeURIComponent(url.split('/').pop()));
  let exec = path.join(outdir, path.parse(dlpath).name, executable);

  if (!existsSync(exec)) {
    // always log this for progress bar context
    let loglevel = log.loglevel();
    log.loglevel('info');

    log.info(`${browser} not found, downloading...`);

    try {
      // ensure the out directory exists
      await fs.mkdir(outdir, { recursive: true });

      // download the file at the given URL and log progress
      await new Promise((resolve, reject) => {
        https.get(url, response => {
          /* istanbul ignore next: failsafe */
          if (response.statusCode !== 200) {
            response.resume();
            reject(new Error(`Download failed: ${response.statusCode} - ${url}`));
            return;
          }

          let size = parseInt(response.headers['content-length'], 10);
          let msg = `${readableBytes(size)} (${revision}) [:bar] :percent :etas`;
          let progress = new (require('progress'))(log.formatter(msg), {
            stream: process.stdout,
            incomplete: ' ',
            total: size,
            width: 20
          });

          let file = createWriteStream(dlpath)
            .on('finish', resolve)
            .on('error', reject);

          response.on('data', chunk => {
            progress.tick(chunk.length);
          }).pipe(file);
        }).on('error', reject);
      });

      // extract the downloaded file
      await extract(dlpath, outdir);

      // log success
      log.info(`Successfully downloaded ${browser}`);
    } finally {
      // always cleanup
      /* istanbul ignore next: hard to cover download failure */
      if (existsSync(dlpath)) {
        await new Promise(resolve => rimraf(dlpath, resolve));
      }

      // restore previous loglevel
      log.loglevel(loglevel);
    }
  }

  // return the path to the executable
  return exec;
}
