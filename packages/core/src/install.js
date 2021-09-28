import fs from 'fs';
import path from 'path';
import https from 'https';
import logger from '@percy/logger';
import { ProxyHttpsAgent } from '@percy/client/dist/request';

// Formats a raw byte integer as a string
function formatBytes(int) {
  let units = ['kB', 'MB', 'GB'];
  let base = 1024;
  let u = -1;

  if (Math.abs(int) < base) return `${int}B`;
  while (Math.abs(int) >= base && u++ < 2) int /= base;
  return `${int.toFixed(1)}${units[u]}`;
}

// Formats milleseconds as "MM:SS"
function formatTime(ms) {
  let minutes = (ms / 1000 / 60).toString().split('.')[0].padStart(2, '0');
  let seconds = (ms / 1000 % 60).toFixed().padStart(2, '0');
  return `${minutes}:${seconds}`;
}

// Formats progress as ":prefix [:bar] :ratio :percent :eta"
function formatProgress(prefix, total, start, progress) {
  let width = 20;

  let ratio = Math.min(Math.max(progress / total, 0), 1);
  let percent = Math.floor(ratio * 100).toFixed(0);

  let barLen = Math.round(width * ratio);
  let barContent = Array(Math.max(0, barLen + 1)).join('=') + (
    Array(Math.max(0, width - barLen + 1)).join(' '));

  let elapsed = Date.now() - start;
  let eta = (ratio >= 1) ? 0 : elapsed * (total / progress - 1);

  return (
    `${prefix} [${barContent}] ` +
    `${formatBytes(progress)}/${formatBytes(total)} ` +
    `${percent}% ${formatTime(eta)}`
  );
}

// Returns an item from the map keyed by the current platform
function selectByPlatform(map) {
  let { platform, arch } = process;
  if (platform === 'win32' && arch === 'x64') platform = 'win64';
  if (platform === 'darwin' && arch === 'arm64') platform = 'darwinArm';
  return map[platform];
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
      darwinArm: `Mac_Arm/${revision}/chrome-mac.zip`,
      win64: `Win_x64/${revision}/chrome-win.zip`,
      win32: `Win/${revision}/chrome-win.zip`
    });

  let executable = selectByPlatform({
    linux: path.join('chrome-linux', 'chrome'),
    win64: path.join('chrome-win', 'chrome.exe'),
    win32: path.join('chrome-win', 'chrome.exe'),
    darwin: path.join('chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'),
    darwinArm: path.join('chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium')
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

// default chromium revisions corresponds to v92.0.4515.x
installChromium.revisions = {
  linux: '885264',
  win64: '885282',
  win32: '885263',
  darwin: '885263',
  darwinArm: '885282'
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
    let premsg = `Downloading ${name} ${revision}`;
    log.progress(`${premsg}...`);

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
        if (log.shouldLog('info') && logger.stdout.isTTY) {
          let total = parseInt(response.headers['content-length'], 10);
          let start, progress;

          response.on('data', chunk => {
            start ??= Date.now();
            progress = (progress ?? 0) + chunk.length;
            log.progress(formatProgress(premsg, total, start, progress));
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
      log.info(`Successfully downloaded ${name} ${revision}`);
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
