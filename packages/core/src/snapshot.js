import logger from '@percy/logger';
import PercyConfig from '@percy/config';
import { merge } from '@percy/config/dist/utils';

import {
  hostnameMatches,
  createRootResource,
  createPercyCSSResource,
  createLogResource
} from './utils';

// Validates and returns snapshot options merged with percy config options.
export function getSnapshotConfig(percy, options) {
  if (!options.url) throw new Error('Missing required URL for snapshot');

  let { config } = percy;
  let uri = new URL(options.url);
  let name = options.name || `${uri.pathname}${uri.search}${uri.hash}`;
  let meta = { snapshot: { name }, build: percy.build };
  let log = logger('core:snapshot');

  // migrate deprecated snapshot config options
  let { clientInfo, environmentInfo, ...opts } = options;
  let snapshot = PercyConfig.migrate(opts, '/snapshot');

  // throw an error when missing required widths
  if (!(snapshot.widths ?? percy.config.snapshot.widths)?.length) {
    throw new Error('Missing required widths for snapshot');
  }

  // validate and scrub according to dom snaphot presence
  let errors = PercyConfig.validate(snapshot, (
    snapshot.domSnapshot ? '/snapshot/dom' : '/snapshot'));

  if (errors) {
    log.warn('Invalid snapshot options:', meta);
    for (let e of errors) log.warn(`- ${e.path}: ${e.message}`, meta);
  }

  // inherit options from the percy config
  return merge([config.snapshot, {
    name,
    meta,
    clientInfo,
    environmentInfo,

    // only specific discovery options are used per-snapshot
    discovery: {
      allowedHostnames: [uri.hostname, ...config.discovery.allowedHostnames],
      requestHeaders: config.discovery.requestHeaders,
      authorization: config.discovery.authorization,
      disableCache: config.discovery.disableCache,
      userAgent: config.discovery.userAgent
    }
  }, snapshot], (path, prev, next) => {
    switch (path.map(k => k.toString()).join('.')) {
      case 'widths': // override and sort widths
        return [path, next.sort((a, b) => a - b)];
      case 'percyCSS': // concatenate percy css
        return [path, [prev, next].filter(Boolean).join('\n')];
      case 'execute': // shorthand for execute.beforeSnapshot
        return (Array.isArray(next) || typeof next !== 'object')
          ? [path.concat('beforeSnapshot'), next] : [path];
    }
  });
}

// Returns a complete and valid snapshot config object and logs verbose debug logs detailing various
// snapshot options. When `showInfo` is true, specific messages will be logged as info logs rather
// than debug logs.
export function debugSnapshotConfig(snapshot, showInfo) {
  let log = logger('core:snapshot');

  // log snapshot info
  log.debug('---------', snapshot.meta);
  if (showInfo) log.info(`Snapshot found: ${snapshot.name}`, snapshot.meta);
  else log.debug(`Handling snapshot: ${snapshot.name}`, snapshot.meta);

  // will log debug info for an object property if its value is defined
  let debugProp = (obj, prop, format = String) => {
    let val = prop.split('.').reduce((o, k) => o?.[k], obj);

    if (val != null) {
      // join formatted array values with a space
      val = [].concat(val).map(format).join(', ');
      log.debug(`- ${prop}: ${val}`, snapshot.meta);
    }
  };

  debugProp(snapshot, 'url');
  debugProp(snapshot, 'widths', v => `${v}px`);
  debugProp(snapshot, 'minHeight', v => `${v}px`);
  debugProp(snapshot, 'enableJavaScript');
  debugProp(snapshot, 'waitForTimeout');
  debugProp(snapshot, 'waitForSelector');
  debugProp(snapshot, 'execute.afterNavigation');
  debugProp(snapshot, 'execute.beforeResize');
  debugProp(snapshot, 'execute.afterResize');
  debugProp(snapshot, 'execute.beforeSnapshot');
  debugProp(snapshot, 'discovery.allowedHostnames');
  debugProp(snapshot, 'discovery.requestHeaders', JSON.stringify);
  debugProp(snapshot, 'discovery.authorization', JSON.stringify);
  debugProp(snapshot, 'discovery.disableCache');
  debugProp(snapshot, 'discovery.userAgent');
  debugProp(snapshot, 'clientInfo');
  debugProp(snapshot, 'environmentInfo');
  debugProp(snapshot, 'domSnapshot', Boolean);

  for (let { name, ...added } of (snapshot.additionalSnapshots || [])) {
    name ||= `${added.prefix || ''}${snapshot.name}${added.suffix || ''}`;
    log[showInfo ? 'info' : 'debug'](`Additional snapshot: ${name}`, snapshot.meta);

    debugProp(added, 'url');
    debugProp(added, 'waitForTimeout');
    debugProp(added, 'waitForSelector');
    debugProp(added, 'execute');
  }
}

// Calls the provided callback with additional resources
function handleSnapshotResources(snapshot, map, callback) {
  let resources = [...map.values()];

  // sort the root resource first
  let [root] = resources.splice(resources.findIndex(r => r.root), 1);
  resources.unshift(root);

  // inject Percy CSS
  if (snapshot.percyCSS) {
    let css = createPercyCSSResource(root.url, snapshot.percyCSS);
    resources.push(css);

    // replace root contents and associated properties
    Object.assign(root, createRootResource(root.url, (
      root.content.replace(/(<\/body>)(?!.*\1)/is, (
        `<link data-percy-specific-css rel="stylesheet" href="${css.pathname}"/>`
      ) + '$&'))));
  }

  // include associated snapshot logs matched by meta information
  resources.push(createLogResource(logger.query(log => (
    log.meta.snapshot?.name === snapshot.meta.snapshot.name
  ))));

  return callback(snapshot, resources);
}

// Wait for a page's asset discovery network to idle
function waitForDiscoveryNetworkIdle(page, options) {
  let { allowedHostnames, networkIdleTimeout } = options;
  let filter = r => hostnameMatches(allowedHostnames, r.url);

  return page.network.idle(filter, networkIdleTimeout);
}

// Used to cache resources across core instances
const RESOURCE_CACHE_KEY = Symbol('resource-cache');

// Discovers resources for a snapshot using a browser page to intercept requests. The callback
// function will be called with the snapshot name (for additional snapshots) and an array of
// discovered resources. When additional snapshots are provided, the callback will be called once
// for each snapshot.
export async function discoverSnapshotResources(percy, snapshot, callback) {
  // keep a global resource cache across snapshots
  let cache = percy[RESOURCE_CACHE_KEY] ||= new Map();
  // copy widths to prevent mutation later
  let widths = snapshot.widths.slice();

  // preload the root resource for existing dom snapshots
  let resources = new Map(snapshot.domSnapshot && (
    [createRootResource(snapshot.url, snapshot.domSnapshot)]
      .map(resource => [resource.url, resource])
  ));

  // open a new browser page
  let page = await percy.browser.page({
    enableJavaScript: snapshot.enableJavaScript ?? !snapshot.domSnapshot,
    networkIdleTimeout: snapshot.discovery.networkIdleTimeout,
    requestHeaders: snapshot.discovery.requestHeaders,
    authorization: snapshot.discovery.authorization,
    userAgent: snapshot.discovery.userAgent,
    meta: snapshot.meta,

    // enable network inteception
    intercept: {
      enableJavaScript: snapshot.enableJavaScript,
      disableCache: snapshot.discovery.disableCache,
      allowedHostnames: snapshot.discovery.allowedHostnames,
      getResource: u => resources.get(u) || cache.get(u),
      saveResource: r => resources.set(r.url, r) && cache.set(r.url, r)
    }
  });

  try {
    // set the initial page size
    await page.resize({
      width: widths.shift(),
      height: snapshot.minHeight
    });

    // navigate to the url
    await page.goto(snapshot.url);
    await page.evaluate(snapshot.execute?.afterNavigation);

    // trigger resize events for other widths
    for (let width of widths) {
      await page.evaluate(snapshot.execute?.beforeResize);
      await waitForDiscoveryNetworkIdle(page, snapshot.discovery);
      await page.resize({ width, height: snapshot.minHeight });
      await page.evaluate(snapshot.execute?.afterResize);
    }

    if (snapshot.domSnapshot) {
      // ensure discovery has finished and handle resources
      await waitForDiscoveryNetworkIdle(page, snapshot.discovery);
      handleSnapshotResources(snapshot, resources, callback);
    } else {
      // capture snapshots sequentially
      let allSnapshots = [snapshot, ...(snapshot.additionalSnapshots || [])];

      for (let { name, prefix = '', suffix = '', ...snap } of allSnapshots) {
        // default name and merge snapshot options
        name ||= `${prefix}${snapshot.name}${suffix}`;
        let options = { ...snapshot, ...snap, name };

        // will wait for timeouts, selectors, and additional network activity
        let { url, dom } = await page.snapshot(options);

        // handle resources and remove previously captured dom snapshots
        resources.set(url, createRootResource(url, dom));
        handleSnapshotResources(options, resources, callback);
        resources.delete(url);
      }
    }

    // page clean up
    await page.close();
  } catch (error) {
    await page.close();
    throw error;
  }
}
