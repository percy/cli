#!/usr/bin/env node

// This is deprecated as it is not working for 115

const url = await import('url');
const path = await import('path');

const SCRIPT_NAME = path.basename(url.fileURLToPath(import.meta.url));

// Usage/help output
if (!process.argv[2]) {
  // eslint-disable-next-line babel/no-unused-expressions
  (console.log(`\
Print a Chromium version's revision for each major platform

USAGE
  $ ${SCRIPT_NAME} VERSION

ARGUMENTS
  VERSION  A Chromium release version

EXAMPLE
 $ ${SCRIPT_NAME} 87.0.4280.88
`), process.exit());
}

// Required after usage for speedy help output
const { request } = await import('@percy/client/utils');
// eslint-disable-next-line import/no-extraneous-dependencies
const { default: logger } = await import('@percy/logger');
const log = logger('script');

// Chromium GitHub constants
const GH_API_URL = 'https://api.github.com/repos/chromium/chromium';
const GH_TAGS_URL = 'https://github.com/chromium/chromium/branch_commits';
const GH_HEADERS = {
  Accept: 'application/vnd.github.v3+json',
  // eslint-disable-next-line no-template-curly-in-string
  'User-Agent': '@percy/cli; ${SCRIPT_NAME}'
};

// Google Storage constants
const G_STORAGE_API_URL = 'https://www.googleapis.com/storage/v1/b/chromium-browser-snapshots/o';
const G_STORAGE_PREFIXES = {
  darwin: 'Mac',
  darwinArm: 'Mac_Arm',
  linux: 'Linux_x64',
  win64: 'Win_x64',
  win32: 'Win'
};

// Runs a stateful async function repeatedly until it returns a truthy value while updating a log
// message with ellipses for each iteration of the task function
async function task({ message, state: init, function: fn }) {
  return await (async function run(state) {
    // log the message with an additional period for each iteration
    let i = state.i = (state.i || 0) + 1;
    log.progress(message(state, '.'.repeat(i)));

    // if the function does not return, run again
    return await fn(state) || run(state);
  })((init?.() || {}));
}

// The actual script that prints a revision corresponding to the provided version for each platform
async function printVersionRevisions(version) {
  // tags cannot be queried for by name with github's rest api; so query as many tags as we can
  // until a matching one is found
  let commit = await task({
    message: (state, dots) => state.value
      ? `Tagged commit: ${state.value.sha}`
      : `Searching for tagged version: ${version}${dots}`,
    async function(state) {
      if (state.value) return state.value;
      // this can be slow - the newer the browser, the less queries are needed
      let tags = await request(`${GH_API_URL}/tags?page=${state.i}&per_page=100`, { headers: GH_HEADERS });
      let match = tags.find(tag => tag.name === version);
      state.value = match && match.commit;
    }
  });

  // a bot likely published the release, so find the first human-authored commit
  let authored = await task({
    state: () => ({ value: commit }),
    message: (state, dots) => state.authored
      ? `Authored commit: ${state.value.sha}`
      : `Fetching authored commit${dots}`,
    async function(state) {
      // get each parent commit until the authored commit is found
      if (state.authored) return state.value;
      let { parents } = await request(state.value.url, { headers: GH_HEADERS });
      let parent = await request(parents[0].url, { headers: GH_HEADERS });
      state.value = parent.commit ? parent.commit : parent;
      // an author name ending in "-bot" is likely an automated commit
      state.authored = !state.value.author.name.endsWith('-bot');
    }
  });

  // parse the authored commit's message for the revision number; relies on the message format
  // ending in "refs/head/main@{000000}" where zeros are the revision number
  let revision = parseInt(authored.message.match(/refs\/heads\/main@\{#(\d+)}$/)[1], 10);
  log.info(`Commit position: ${revision}`);

  // for each platform, find the first suitable revision matching the desired version spanning back
  // 50 revisions (not all platforms release at the same time)
  let revisions = await task({
    state: () => ({
      platforms: ['linux', 'win64', 'win32', 'darwin', 'darwinArm'],
      range: [revision - 50, revision],
      value: {}
    }),
    message: (state, dots) => state.i <= state.platforms.length
      ? `Determining platform revisions: ${state.platforms[state.i - 1]}${dots}`
      : 'Matching revisions:',
    async function(state) {
      let platform = state.platforms[state.i - 1];
      if (!platform) return state.value;
      let rev = state.range[1];

      for (; rev >= state.range[0]; rev--) {
        // query google's storage api for the platform revision
        let { items } = await request((
          `${G_STORAGE_API_URL}?fields=items(name,metadata)&` +
            `prefix=${G_STORAGE_PREFIXES[platform]}/${rev}`
        ), {});

        // no matching revision for this platform
        if (!items) continue;
        // check if the revision's commit is included in the desired release version
        let sha = items[0].metadata['cr-git-commit'];
        let tags = (await request(`${GH_TAGS_URL}/${sha}`, {}))
          .match(/\/releases\/tag\/[\d.]+/g)
          .map(t => t.replace('/releases/tag/', ''));

        // no matching version for this revision
        if (!tags.includes(version)) continue;

        // found a suitable revision for this platform
        state.value[platform] = {
          version: tags[tags.length - 1],
          revision: rev,
          sha
        };

        break;
      }

      // no suitable revision was found for this platform
      state.value[platform] ||= {
        revision: '-'.repeat(String(rev).length),
        version: 'no match',
        sha: 'none'
      };
    }
  });

  // log all matching revisions
  logger.stdout.write('\n' + (
    Object.entries(revisions).map(([platform, i]) => (
      `${platform}: ${i.revision} (${i.sha}; ${i.version})`
    )).join('\n') + '\n\n'));
}

// call the script with the first provided arg
printVersionRevisions(process.argv[2]).catch(error => {
  // request errors have a response body
  log.error(error.response?.body?.message || error);
});
