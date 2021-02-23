/* istanbul ignore file: this utility is required to work before tests to download the browser
 * binary; since it is technically tested before the tests run, it does not generate coverage */
import path from 'path';
import https from 'https';
import {
  promises as fs,
  existsSync,
  createWriteStream
} from 'fs';
import rimraf from 'rimraf';
import logger from '@percy/logger';
import readableBytes from './bytes';

// used to determine platform defaults
const platform = (
  process.platform === 'win32' && process.arch === 'x64'
    ? 'win64' : process.platform
);

export default async function install({
  // default discovery browser is chromium
  browser = 'Chromium',
  // default chromium version is 87.0.4280.xx
  revision = {
    linux: '812847',
    win64: '812845',
    win32: '812822',
    darwin: '812851'
  }[platform],
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
    linux: path.join('chrome-linux', 'chrome'),
    win64: path.join('chrome-win', 'chrome.exe'),
    win32: path.join('chrome-win32', 'chrome.exe'),
    darwin: path.join('chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium')
  }[platform]
} = {}) {
  let outdir = path.join(directory, revision);
  let dlpath = path.join(outdir, decodeURIComponent(url.split('/').pop()));
  let exec = path.join(outdir, executable);

  if (!existsSync(exec)) {
    // always log this for progress bar context
    let loglevel = logger.loglevel();
    logger.loglevel('info');

    logger().info(`${browser} not found, downloading...`);

    try {
      // ensure the out directory exists
      await fs.mkdir(outdir, { recursive: true });

      // download the file at the given URL and log progress
      await new Promise((resolve, reject) => {
        https.get(url, response => {
          if (response.statusCode !== 200) {
            response.resume();
            reject(new Error(`Download failed: ${response.statusCode} - ${url}`));
            return;
          }

          let size = parseInt(response.headers['content-length'], 10);
          let msg = `${readableBytes(size)} (${revision}) [:bar] :percent :etas`;
          let progress = new (require('progress'))(logger.format(msg), {
            stream: logger.instance.stdout,
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
      logger().info(`Successfully downloaded ${browser}`);
    } finally {
      // always cleanup
      if (existsSync(dlpath)) {
        await new Promise(resolve => rimraf(dlpath, resolve));
      }

      // restore previous loglevel
      logger.loglevel(loglevel);
    }
  }

  // return the path to the executable
  return exec;
}
