import logger from '@percy/logger';
import PercyConfig from '@percy/config';
import micromatch from 'micromatch';
import { configSchema } from './config.js';
import Queue from './queue.js';
import {
  request,
  hostnameMatches,
  yieldTo
} from './utils.js';

// Throw a better error message for missing or invalid urls
function validURL(url, base) {
  if (!url) {
    throw new Error('Missing required URL for snapshot');
  }

  try {
    return new URL(url, base);
  } catch (e) {
    throw new Error(`Invalid snapshot URL: ${e.input}`);
  }
}

// used to deserialize regular expression strings
const RE_REGEXP = /^\/(.+)\/(\w+)?$/;

// Returns true or false if a snapshot matches the provided include and exclude predicates. A
// predicate can be an array of predicates, a regular expression, a glob pattern, or a function.
function snapshotMatches(snapshot, include, exclude) {
  // support an options object as the second argument
  if (include?.include || include?.exclude) ({ include, exclude } = include);

  // recursive predicate test function
  let test = (predicate, fallback) => {
    if (predicate && typeof predicate === 'string') {
      // snapshot name matches exactly or matches a glob
      let result = snapshot.name === predicate ||
        micromatch.isMatch(snapshot.name, predicate);

      // snapshot might match a string-based regexp pattern
      if (!result) {
        try {
          let [, parsed, flags] = RE_REGEXP.exec(predicate) || [];
          result = !!parsed && new RegExp(parsed, flags).test(snapshot.name);
        } catch {}
      }

      return result;
    } else if (predicate instanceof RegExp) {
      // snapshot matches a regular expression
      return predicate.test(snapshot.name);
    } else if (typeof predicate === 'function') {
      // advanced matching
      return predicate(snapshot);
    } else if (Array.isArray(predicate) && predicate.length) {
      // array of predicates
      return predicate.some(p => test(p));
    } else {
      // default fallback
      return fallback;
    }
  };

  // nothing to match, return true
  if (!include && !exclude) return true;
  // not excluded or explicitly included
  return !test(exclude, false) && test(include, true);
}

// Accepts an array of snapshots to filter and map with matching options.
function mapSnapshotOptions(snapshots, context) {
  if (!snapshots?.length) return [];

  // reduce options into a single function
  let applyOptions = [].concat(context?.options || [])
    .reduceRight((next, { include, exclude, ...opts }) => snap => next(
      // assign additional options to included snaphots
      snapshotMatches(snap, include, exclude) ? Object.assign(snap, opts) : snap
    ), snap => getSnapshotOptions(snap, context));

  // reduce snapshots with overrides
  return snapshots.reduce((acc, snapshot) => {
    // transform snapshot URL shorthand into an object
    if (typeof snapshot === 'string') snapshot = { url: snapshot };

    // normalize the snapshot url and use it for the default name
    let url = validURL(snapshot.url, context?.baseUrl);
    snapshot.name ||= `${url.pathname}${url.search}${url.hash}`;
    snapshot.url = url.href;

    // use the snapshot when matching include/exclude
    if (snapshotMatches(snapshot, context)) {
      acc.push(applyOptions(snapshot));
    }

    return acc;
  }, []);
}

// Return snapshot options merged with defaults and global config.
function getSnapshotOptions(options, { config, meta }) {
  return PercyConfig.merge([{
    widths: configSchema.snapshot.properties.widths.default,
    discovery: { allowedHostnames: [validURL(options.url).hostname] },
    meta: { ...meta, snapshot: { name: options.name } }
  }, config.snapshot, {
    // only specific discovery options are used per-snapshot
    discovery: {
      allowedHostnames: config.discovery.allowedHostnames,
      disallowedHostnames: config.discovery.disallowedHostnames,
      networkIdleTimeout: config.discovery.networkIdleTimeout,
      requestHeaders: config.discovery.requestHeaders,
      authorization: config.discovery.authorization,
      disableCache: config.discovery.disableCache,
      userAgent: config.discovery.userAgent
    }
  }, options], (path, prev, next) => {
    switch (path.map(k => k.toString()).join('.')) {
      case 'widths': // dedup, sort, and override widths when not empty
        return [path, !next?.length ? prev : [...new Set(next)].sort((a, b) => a - b)];
      case 'percyCSS': // concatenate percy css
        return [path, [prev, next].filter(Boolean).join('\n')];
      case 'execute': // shorthand for execute.beforeSnapshot
        return (Array.isArray(next) || typeof next !== 'object')
          ? [path.concat('beforeSnapshot'), next] : [path];
      case 'discovery.disallowedHostnames': // prevent disallowing the root hostname
        return [path, !next?.length ? prev : (
          (prev ?? []).concat(next).filter(h => !hostnameMatches(h, options.url))
        )];
    }

    // ensure additional snapshots have complete names
    if (path[0] === 'additionalSnapshots' && path.length === 2) {
      let { prefix = '', suffix = '', ...n } = next;
      next = { name: `${prefix}${options.name}${suffix}`, ...n };
      return [path, next];
    }
  });
}

// Validates and migrates snapshot options against the correct schema based on provided
// properties. Eagerly throws an error when missing a URL for any snapshot, and warns about all
// other invalid options which are also scrubbed from the returned migrated options.
export function validateSnapshotOptions(options) {
  // decide which schema to validate against
  let schema = (
    (['domSnapshot', 'dom-snapshot', 'dom_snapshot']
      .some(k => k in options) && '/snapshot/dom') ||
    ('url' in options && '/snapshot') ||
    ('sitemap' in options && '/snapshot/sitemap') ||
    ('serve' in options && '/snapshot/server') ||
    ('snapshots' in options && '/snapshot/list') ||
    ('/snapshot'));

  let {
    // normalize, migrate, and remove certain properties from validating
    clientInfo, environmentInfo, snapshots, ...migrated
  } = PercyConfig.migrate(options, schema);

  // maintain a trailing slash for base URLs to normalize them
  if (migrated.baseUrl?.endsWith('/') === false) migrated.baseUrl += '/';
  let baseUrl = schema === '/snapshot/server' ? 'http://localhost/' : migrated.baseUrl;

  // gather info for validating individual snapshot URLs
  let isSnapshot = schema === '/snapshot/dom' || schema === '/snapshot';
  let snaps = isSnapshot ? [migrated] : Array.isArray(snapshots) ? snapshots : [];
  for (let snap of snaps) validURL(typeof snap === 'string' ? snap : snap.url, baseUrl);

  // add back snapshots before validating and scrubbing; function snapshots are validated later
  if (snapshots) migrated.snapshots = typeof snapshots === 'function' ? [] : snapshots;
  else if (!isSnapshot && options.snapshots) migrated.snapshots = [];
  let errors = PercyConfig.validate(migrated, schema);

  if (errors) {
    // warn on validation errors
    let log = logger('core:snapshot');
    log.warn('Invalid snapshot options:');
    for (let e of errors) log.warn(`- ${e.path}: ${e.message}`);
  }

  // add back the snapshots function if there was one
  if (typeof snapshots === 'function') migrated.snapshots = snapshots;
  // add back an empty array if all server snapshots were scrubbed
  if ('serve' in options && 'snapshots' in options) migrated.snapshots ??= [];

  return { clientInfo, environmentInfo, ...migrated };
}

// Fetches a sitemap and parses it into a list of URLs for taking snapshots. Duplicate URLs,
// including a trailing slash, are removed from the resulting list.
async function getSitemapSnapshots(options) {
  return request(options.sitemap, (body, res) => {
    // validate sitemap content-type
    let [contentType] = res.headers['content-type'].split(';');

    if (!/^(application|text)\/xml$/.test(contentType)) {
      throw new Error('The sitemap must be an XML document, ' + (
        `but the content-type was "${contentType}"`));
    }

    // parse XML content into a list of URLs
    let urls = body.match(/(?<=<loc>)(.*?)(?=<\/loc>)/ig) ?? [];

    // filter out duplicate URLs that differ by a trailing slash
    return urls.filter((url, i) => {
      let match = urls.indexOf(url.replace(/\/$/, ''));
      return match === -1 || match === i;
    });
  });
}

// Returns an array of derived snapshot options
export async function* gatherSnapshots(options, context) {
  let { baseUrl, snapshots } = options;

  if ('url' in options) [snapshots, options] = [[options], {}];
  if ('sitemap' in options) snapshots = yield getSitemapSnapshots(options);

  // validate evaluated snapshots
  if (typeof snapshots === 'function') {
    snapshots = yield* yieldTo(snapshots(baseUrl));
    snapshots = validateSnapshotOptions({ baseUrl, snapshots }).snapshots;
  }

  // map snapshots with snapshot options
  snapshots = mapSnapshotOptions(snapshots, { ...options, ...context });
  if (!snapshots.length) throw new Error('No snapshots found');

  return snapshots;
}

// Merges snapshots and deduplicates resource arrays. Duplicate log resources are replaced, root
// resources are deduplicated by widths, and all other resources are deduplicated by their URL.
function mergeSnapshotOptions(prev = {}, next) {
  let { resources: oldResources = [], ...existing } = prev;
  let { resources: newResources = [], widths = [], width, ...incoming } = next;

  // prioritize singular widths over mutilple widths
  widths = width ? [width] : widths;

  // deduplicate resources by associated widths and url
  let resources = oldResources.reduce((all, resource) => {
    if (resource.log || resource.widths.every(w => widths.includes(w))) return all;
    if (!resource.root && all.some(r => r.url === resource.url)) return all;
    resource.widths = resource.widths.filter(w => !widths.includes(w));
    return all.concat(resource);
  }, newResources.map(r => ({ ...r, widths })));

  // sort resources after merging; roots first by min-width & logs last
  resources.sort((a, b) => {
    if (a.root && b.root) return Math.min(...b.widths) - Math.min(...a.widths);
    return (a.root || b.log) ? -1 : (a.log || b.root) ? 1 : 0;
  });

  // overwrite resources and ensure unique widths
  return PercyConfig.merge([
    existing, incoming, { widths, resources }
  ], (path, prev, next) => {
    if (path[0] === 'resources') return [path, next];
    if (path[0] === 'widths' && prev && next) {
      return [path, [...new Set([...prev, ...next])]];
    }
  });
}

// Creates a snapshots queue that manages a Percy build and uploads snapshots.
export function createSnapshotsQueue(percy) {
  let { concurrency } = percy.config.discovery;
  let queue = new Queue();
  let build;

  return queue
    .set({ concurrency })
  // on start, create a new Percy build
    .handle('start', async () => {
      try {
        build = percy.build = {};
        let { data } = await percy.client.createBuild();
        let url = data.attributes['web-url'];
        let number = data.attributes['build-number'];
        Object.assign(build, { id: data.id, url, number });
        // immediately run the queue if not delayed or deferred
        if (!percy.delayUploads && !percy.deferUploads) queue.run();
      } catch (err) {
        // immediately throw the error if not delayed or deferred
        if (!percy.delayUploads && !percy.deferUploads) throw err;
        Object.assign(build, { error: 'Failed to create build' });
        percy.log.error(build.error);
        percy.log.error(err);
        queue.close(true);
      }
    })
  // on end, maybe finalize the build and log about build info
    .handle('end', async () => {
      if (!percy.readyState) return;

      if (build?.failed) {
        percy.log.warn(`Build #${build.number} failed: ${build.url}`, { build });
      } else if (build?.id) {
        await percy.client.finalizeBuild(build.id);
        percy.log.info(`Finalized build #${build.number}: ${build.url}`, { build });
      } else {
        percy.log.warn('Build not created', { build });
      }
    })
  // snapshots are unique by name alone
    .handle('find', ({ name }, snapshot) => (
      snapshot.name === name
    ))
  // when pushed, maybe flush old snapshots or possibly merge with existing snapshots
    .handle('push', (snapshot, existing) => {
      let { name, meta } = snapshot;

      // log immediately when not deferred or dry-running
      if (!percy.deferUploads) percy.log.info(`Snapshot taken: ${name}`, meta);
      if (percy.dryRun) percy.log.info(`Snapshot found: ${name}`, meta);

      // immediately flush when uploads are delayed but not skipped
      if (percy.delayUploads && !percy.skipUploads) queue.flush();
      // overwrite any existing snapshot when not deferred or when resources is a function
      if (!percy.deferUploads || typeof snapshot.resources === 'function') return snapshot;
      // merge snapshot options when uploads are deferred
      return mergeSnapshotOptions(existing, snapshot);
    })
  // send snapshots to be uploaded to the build
    .handle('task', async function*({ resources, ...snapshot }) {
      let { name, meta } = snapshot;

      // yield to evaluated snapshot resources
      snapshot.resources = typeof resources === 'function'
        ? yield* yieldTo(resources())
        : resources;

      // upload the snapshot and log when deferred
      let response = yield percy.client.sendSnapshot(build.id, snapshot);
      if (percy.deferUploads) percy.log.info(`Snapshot uploaded: ${name}`, meta);

      return { ...snapshot, response };
    })
  // handle possible build errors returned by the API
    .handle('error', (snapshot, error) => {
      let result = { ...snapshot, error };
      let { name, meta } = snapshot;

      if (error.name === 'QueueClosedError') return result;
      if (error.name === 'AbortError') return result;

      let failed = error.response?.statusCode === 422 && (
        error.response.body.errors.find(e => (
          e.source?.pointer === '/data/attributes/build'
        )));

      if (failed) {
        build.error = error.message = failed.detail;
        build.failed = true;
        queue.close(true);
      }

      percy.log.error(`Encountered an error uploading snapshot: ${name}`, meta);
      percy.log.error(error, meta);
      return result;
    });
}
