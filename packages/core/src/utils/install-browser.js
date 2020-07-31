import fs from 'fs';
import puppeteer from 'puppeteer-core';
import log from '@percy/logger';
import readableBytes from './bytes';

// Get the default revisions from within puppeteer
import { PUPPETEER_REVISIONS } from 'puppeteer-core/lib/cjs/puppeteer/revisions';

// If the default Chromium revision is not yet downloaded, download it. Lazily
// requires the progress package to print a progress bar during the download.
export default async function maybeInstallBrowser(
  path = process.env.PUPPETEER_EXECUTABLE_PATH
) {
  let revision = PUPPETEER_REVISIONS.chromium;
  let local = false;

  if (path) {
    if (!fs.existsSync(path)) {
      log.error(`Puppeteer executable path not found: ${path}`);
    } else {
      return path;
    }
  }

  let fetcher = puppeteer.createBrowserFetcher();
  ({ executablePath: path, local, revision } = fetcher.revisionInfo(revision));

  if (!local) {
    let ProgressBar = require('progress');
    let progress, last;

    // we always want to log this
    let loglevel = log.loglevel();
    log.loglevel('info');
    log.info('Chromium not found, downloading...');

    await fetcher.download(revision, (downloaded, total) => {
      progress = progress || new ProgressBar(
        log.formatter(`Chromium r${revision} - ${readableBytes(total)} [:bar] :percent :etas`),
        { incomplete: ' ', width: 21, total, stream: process.stdout }
      );

      progress.tick(downloaded - last);
      last = downloaded;
    });

    process.stdout.write('\n');
    log.info('Successfully downloaded Chromium');
    log.loglevel(loglevel);

    ({ executablePath: path } = fetcher.revisionInfo(revision));
  }

  return path;
}
