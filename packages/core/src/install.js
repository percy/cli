import fs from 'fs';
import path from 'path';
import https from 'https';
import logger from '@percy/logger';
import { ProxyHttpsAgent } from '@percy/client/dist/request';
import readableBytes from './utils/bytes';

// Returns an item from the map keyed by the current platform
function selectByPlatform(map) {
  let { platform, arch } = process;
  return map[platform === 'win32' && arch === 'x64' ? 'win64' : platform];
}

// Installs a revision of Chromium to a local directory
function installChromium({
  // default directory is within @percy/core package root
  directory = path.resolve(__dirname, '../.local-chromium'),
  // default chromium revision by platform (see installChromium.revisions)
  revision = selectByPlatform(installChromium.revisions)
} = {}) {
  let extract = (i, o) => require('extract-zip')(i, { dir: o });

  let url = 'https://storage.googleapis.com/chromium-browser-snapshots/' +
    selectByPlatform({
      linux: `Linux_x64/${revision}/chrome-linux.zip`,
      darwin: `Mac/${revision}/chrome-mac.zip`,
      win64: `Win_x64/${revision}/chrome-win.zip`,
      win32: `Win/${revision}/chrome-win.zip`
    });

  let executable = selectByPlatform({
    linux: path.join('chrome-linux', 'chrome'),
    win64: path.join('chrome-win', 'chrome.exe'),
    win32: path.join('chrome-win', 'chrome.exe'),
    darwin: path.join('chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium')
  });

  return install({
    name: 'Chromium',
    revision,
    url,
    extract,
    directory,
    executable
  });
}

// default chromium revisions corresponds to v87.0.4280.x
installChromium.revisions = {
  linux: '812847',
  win64: '812845',
  win32: '812822',
  darwin: '812851'
};

// Installs an executable from a url to a local directory, returning the full path to the extracted
// binary. Skips installation if the executable already exists at the binary path.
async function install({
  name,
  revision,
  url,
  extract,
  directory,
  executable
}) {
  let outdir = path.join(directory, revision);
  let archive = path.join(outdir, decodeURIComponent(url.split('/').pop()));
  let exec = path.join(outdir, executable);

  if (!fs.existsSync(exec)) {
    let log = logger('core:install');
    log.info(`${name} not found, downloading...`);

    try {
      // ensure the out directory exists
      await fs.promises.mkdir(outdir, { recursive: true });

      // download the file at the given URL
      await new Promise((resolve, reject) => https.get(url, {
        agent: new ProxyHttpsAgent() // allow proxied requests
      }, response => {
        // on failure, resume the response before rejecting
        if (response.statusCode !== 200) {
          response.resume();
          reject(new Error(`Download failed: ${response.statusCode} - ${url}`));
          return;
        }

        // log progress
        if (log.shouldLog('info')) {
          let size = parseInt(response.headers['content-length'], 10);
          let msg = `${readableBytes(size)} (${revision}) [:bar] :percent :etas`;
          let progress = new (require('progress'))(logger.format(msg), {
            stream: logger.stdout,
            incomplete: ' ',
            total: size,
            width: 20
          });

          response.on('data', chunk => {
            progress.tick(chunk.length);
          });
        }

        // pipe the response directly to a file
        response.pipe(
          fs.createWriteStream(archive)
            .on('finish', resolve)
            .on('error', reject)
        );
      }).on('error', reject));

      // extract the downloaded file
      await extract(archive, outdir);

      // log success
      log.info(`Successfully downloaded ${name}`);
    } finally {
      // always cleanup the archive
      if (fs.existsSync(archive)) {
        await fs.promises.unlink(archive);
      }
    }
  }

  // return the path to the executable
  return exec;
}

// commonjs friendly
module.exports = install;
module.exports.chromium = installChromium;
module.exports.selectByPlatform = selectByPlatform;
