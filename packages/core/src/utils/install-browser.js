import os from 'os';
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

export default async function install({
  // default discovery browser is chromium
  browser = 'Chromium',
  // default chromium version is 78.0.3904.87
  revision = '693954',
  // default download directory is in @percy/core root
  directory = path.resolve(__dirname, '../../.local-chromium'),
  // default download url is dependent on platform and revision
  url = `https://storage.googleapis.com/chromium-browser-snapshots/${{
    linux: `Linux_x64/${revision}/chrome-linux.zip`,
    darwin: `Mac/${revision}/chrome-mac.zip`,
    win32: os.arch() === 'x64'
      ? `Win_x64/${revision}/chrome-win64.zip`
      /* istanbul ignore next: hard to cover sans combined reports */
      : `Win/${revision}/chrome-win32.zip`
  }[os.platform()]}`,
  // default extraction method is to unzip
  extract = (i, o) => require('extract-zip')(i, { dir: o }),
  // default exectuable location within the extracted archive
  executable = {
    linux: 'chrome',
    win32: 'chrome.exe',
    darwin: path.join('Chromium.app', 'Contents', 'MacOS', 'Chromium')
  }[os.platform()]
} = {}) {
  let outdir = path.join(directory, revision);
  let dlpath = path.join(outdir, url.split('/').pop());
  let exec = path.join(outdir, path.parse(dlpath).name, executable);

  if (!existsSync(exec)) {
    // always log this for progress bar context
    let loglevel = log.loglevel();
    log.loglevel('info');

    log.info(`${browser} not found, downloading...`);

    // ensure the out directory exists
    await fs.mkdir(outdir, { recursive: true });

    // download the file at the given URL and log progress
    await new Promise((resolve, reject) => {
      https.get(url, response => {
        let file = createWriteStream(dlpath);
        let size = parseInt(response.headers['content-length'], 10);
        let msg = `${revision} - ${readableBytes(size)} [:bar] :percent :etas`;
        let progress = new (require('progress'))(log.formatter(msg), {
          stream: process.stdout,
          incomplete: ' ',
          total: size,
          width: 20
        });

        response.on('data', chunk => {
          file.write(chunk);
          progress.tick(chunk.length);
        }).on('end', () => {
          file.end();
          resolve();
        });
      }).on('error', reject);
    });

    // extract the downloaded file and cleanup
    await extract(dlpath, outdir);
    await new Promise(resolve => rimraf(dlpath, resolve));

    // log success and restore previous loglevel
    log.info(`Successfully downloaded ${browser}`);
    log.loglevel(loglevel);
  }

  // return the path to the executable
  return exec;
}
