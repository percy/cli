import fs from 'fs';
import url from 'url';
import path from 'path';
import logger from '@percy/logger';
import { colors } from '@percy/logger/utils';
import { getPackageJSON } from '@percy/cli-command/utils';

// filepath where the cache will be read and written to
const CACHE_FILE = path.resolve(url.fileURLToPath(import.meta.url), '../../.releases');
// max age the cache should be used for (3 days)
const CACHE_MAX_AGE = 3 * 24 * 60 * 60 * 1000;
// how many stable releases behind before the warning escalates
const MANY_RELEASES_BEHIND = 10;
// where users are pointed to see what changed
const RELEASES_URL = 'https://github.com/percy/cli/releases';

// Safely read from CACHE_FILE and return an object containing `data` mirroring what was previously
// written using `writeToCache(data)`. An empty object is returned when older than CACHE_MAX_AGE,
// and an `error` will be present if one was encountered.
function readFromCache() {
  let cached = {};

  try {
    if (fs.existsSync(CACHE_FILE)) {
      let { createdAt, data } = JSON.parse(fs.readFileSync(CACHE_FILE));
      if ((Date.now() - createdAt) < CACHE_MAX_AGE) cached.data = data;
    }
  } catch (error) {
    let log = logger('cli:update:cache');
    log.debug('Unable to read from cache');
    log.debug(cached.error = error);
  }

  return cached;
}

// Safely write data to CACHE_FILE with the current timestamp.
function writeToCache(data) {
  try {
    fs.writeFileSync(CACHE_FILE, JSON.stringify({
      createdAt: Date.now(),
      data
    }));
  } catch (error) {
    let log = logger('cli:update:cache');
    log.debug('Unable to write to cache');
    log.debug(error);
  }
}

// Parse a version string into its comparable parts. Release tags are inconsistently prefixed with
// a `v`, so the prefix is optional. Returns null for anything unparseable so callers can bail out
// rather than warn about a comparison that cannot be trusted.
function parseVersion(version) {
  let match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([\w.-]+))?$/.exec(String(version).trim());
  if (!match) return null;

  return {
    major: parseInt(match[1], 10),
    minor: parseInt(match[2], 10),
    patch: parseInt(match[3], 10),
    prerelease: match[4] || null,
    // a prerelease precedes the stable release of the same version, so it sorts lower
    stable: match[4] ? 0 : 1,
    // the version without any `v` prefix, for display
    version: match[0].replace(/^v/, '')
  };
}

// Compare two parsed versions, returning a negative number when `a` precedes `b`, a positive
// number when it follows, and zero when they are equal. Prerelease identifiers are not compared
// against each other, since only stable releases are ever compared - the sole prerelease involved
// is the version currently installed, and a prerelease always precedes its own stable release.
function compareVersions(a, b) {
  for (let part of ['major', 'minor', 'patch', 'stable']) {
    if (a[part] !== b[part]) return a[part] - b[part];
  }

  return 0;
}

// Fetch and return release information for @percy/cli.
async function fetchReleases(pkg) {
  let { request } = await import('@percy/client/utils');

  // fetch releases from the github api without retries. a full page is requested since the majority
  // of releases are prereleases, and those are filtered out before comparing versions
  let api = 'https://api.github.com/repos/percy/cli/releases?per_page=100';
  let data = await request(api, {
    headers: { 'User-Agent': pkg.name },
    retries: 0
  });

  // return relevant information
  return data.map(r => ({
    tag: r.tag_name,
    prerelease: r.prerelease
  }));
}

// Check for updates by comparing latest releases with the current version. The result of the check
// is cached to speed up subsequent CLI usage.
export async function checkForUpdate() {
  let { data: releases, error: cacheError } = readFromCache();
  let pkg = getPackageJSON(import.meta.url);
  let log = logger('cli:update');

  if (process.env.PERCY_SKIP_UPDATE_CHECK) {
    log.debug('Skipping update check');
    return;
  }

  try {
    // request new release information if needed
    if (!releases) {
      releases = await fetchReleases(pkg);
      if (!cacheError) writeToCache(releases);
    }

    let current = parseVersion(pkg.version);

    if (!current) {
      log.debug(`Unable to parse the current version: ${pkg.version}`);
      return;
    }

    // only compare against stable releases - alpha/beta versions are excluded both by the release
    // flag and by their own version, since the flag is set by hand and is sometimes wrong
    let versions = releases.reduce((acc, r) => {
      let parsed = !r.prerelease && parseVersion(r.tag);
      if (parsed && !parsed.prerelease) acc.push(parsed);
      return acc;
    }, []);

    if (!versions.length) {
      log.debug('No stable releases found to compare against');
      return;
    }

    // sort newest first rather than trusting the order releases were published in
    versions.sort((a, b) => compareVersions(b, a));
    let [latest] = versions;

    // already on the latest stable release, or ahead of it - nothing to warn about
    if (compareVersions(current, latest) >= 0) {
      log.debug(`Current version ${current.version} is up to date (latest is ${latest.version})`);
      return;
    }

    // a prerelease is intentionally not the latest stable release, so counting releases behind is
    // meaningless. say what it actually is and what the latest stable release is instead
    if (current.prerelease) {
      log.warn('\nYou are using a pre-release build of @percy/cli. ' +
        `${colors.red(current.version)} -> ${colors.green(latest.version)} (latest stable)\n`);
      return;
    }

    // the number of stable releases newer than the current one. this is only a real count when the
    // current version falls within the window of releases fetched - otherwise it is a lower bound,
    // and reporting a lower bound as though it were exact is what made this warning misleading
    let behind = versions.filter(v => compareVersions(v, current) > 0).length;
    let known = compareVersions(current, versions[versions.length - 1]) >= 0;
    let versionChange = `${colors.red(current.version)} -> ${colors.green(latest.version)}`;

    if (!known) {
      log.warn('\nHeads up! Your @percy/cli is significantly out of date. ' +
        `${versionChange}\nSee ${RELEASES_URL} for what changed.\n`);
    } else if (behind >= MANY_RELEASES_BEHIND || current.major < latest.major) {
      log.warn(`\nHeads up! Your @percy/cli is ${behind} ${behind === 1 ? 'release' : 'releases'} ` +
        `behind the latest release. ${versionChange}\n` +
        `See ${RELEASES_URL} for what changed.\n`);
    } else {
      log.warn(`\nA new version of @percy/cli is available! ${versionChange}\n`);
    }
  } catch (err) {
    log.debug('Unable to check for updates');
    log.debug(err);
  }
}

export default checkForUpdate;
