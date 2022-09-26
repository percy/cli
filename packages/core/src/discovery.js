import logger from '@percy/logger';
import Queue from './queue.js';
import {
  normalizeURL,
  hostnameMatches,
  createRootResource,
  createPercyCSSResource,
  createLogResource,
  yieldAll
} from './utils.js';

// Logs verbose debug logs detailing various snapshot options.
function debugSnapshotOptions(snapshot) {
  let log = logger('core:snapshot');

  // log snapshot info
  log.debug('---------', snapshot.meta);
  log.debug(`Received snapshot: ${snapshot.name}`, snapshot.meta);

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
  debugProp(snapshot, 'scope');
  debugProp(snapshot, 'widths', v => `${v}px`);
  debugProp(snapshot, 'minHeight', v => `${v}px`);
  debugProp(snapshot, 'enableJavaScript');
  debugProp(snapshot, 'deviceScaleFactor');
  debugProp(snapshot, 'waitForTimeout');
  debugProp(snapshot, 'waitForSelector');
  debugProp(snapshot, 'execute.afterNavigation');
  debugProp(snapshot, 'execute.beforeResize');
  debugProp(snapshot, 'execute.afterResize');
  debugProp(snapshot, 'execute.beforeSnapshot');
  debugProp(snapshot, 'discovery.allowedHostnames');
  debugProp(snapshot, 'discovery.disallowedHostnames');
  debugProp(snapshot, 'discovery.requestHeaders', JSON.stringify);
  debugProp(snapshot, 'discovery.authorization', JSON.stringify);
  debugProp(snapshot, 'discovery.disableCache');
  debugProp(snapshot, 'discovery.userAgent');
  debugProp(snapshot, 'clientInfo');
  debugProp(snapshot, 'environmentInfo');
  debugProp(snapshot, 'domSnapshot', Boolean);

  for (let added of (snapshot.additionalSnapshots || [])) {
    log.debug(`Additional snapshot: ${added.name}`, snapshot.meta);
    debugProp(added, 'waitForTimeout');
    debugProp(added, 'waitForSelector');
    debugProp(added, 'execute');
  }
}

// Wait for a page's asset discovery network to idle
function waitForDiscoveryNetworkIdle(page, options) {
  let { allowedHostnames, networkIdleTimeout } = options;
  let filter = r => hostnameMatches(allowedHostnames, r.url);

  return page.network.idle(filter, networkIdleTimeout);
}

// Calls the provided callback with additional resources
function processSnapshotResources({ domSnapshot, resources, ...snapshot }) {
  resources = [...(resources?.values() ?? [])];

  // find or create a root resource if one does not exist
  let root = resources.find(r => r.content === domSnapshot);

  if (!root) {
    root = createRootResource(snapshot.url, domSnapshot);
    resources.unshift(root);
  }

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

  return { ...snapshot, resources };
}

// Triggers the capture of resource requests for a page by iterating over snapshot widths to resize
// the page and calling any provided execute options.
async function* captureSnapshotResources(page, snapshot, options) {
  let { discovery, additionalSnapshots = [], ...baseSnapshot } = snapshot;
  if (typeof options === 'function') options = { capture: options };
  let { capture, deviceScaleFactor, mobile } = options;

  // used to resize the using capture options
  let resize = width => page.resize({
    height: snapshot.minHeight,
    deviceScaleFactor,
    mobile,
    width
  });

  // navigate to the url
  yield resize(snapshot.widths[0]);
  yield page.goto(snapshot.url);

  if (snapshot.execute) {
    // when any execute options are provided, inject snapshot options
    /* istanbul ignore next: cannot detect coverage of injected code */
    yield page.eval((_, s) => (window.__PERCY__.snapshot = s), snapshot);
    yield page.evaluate(snapshot.execute.afterNavigation);
  }

  // iterate over additional snapshots for proper DOM capturing
  for (let additionalSnapshot of [baseSnapshot, ...additionalSnapshots]) {
    let isBaseSnapshot = additionalSnapshot === baseSnapshot;
    let snap = { ...baseSnapshot, ...additionalSnapshot };

    // iterate over widths to trigger reqeusts for the base snapshot
    if (isBaseSnapshot) {
      for (let i = 0; i < snap.widths.length - 1; i++) {
        yield page.evaluate(snap.execute?.beforeResize);
        yield waitForDiscoveryNetworkIdle(page, discovery);
        yield resize(snap.widths[i + 1]);
        yield page.evaluate(snap.execute?.afterResize);
      }
    }

    if (capture && !snapshot.domSnapshot) {
      // capture this snapshot and update the base snapshot after capture
      let captured = yield page.snapshot(snap);
      if (isBaseSnapshot) baseSnapshot = captured;

      // remove any discovered root resource request
      captured.resources.delete(normalizeURL(captured.url));
      capture(processSnapshotResources(captured));
    }
  }

  // recursively trigger resource requests for any alternate device pixel ratio
  if (deviceScaleFactor !== discovery.devicePixelRatio) {
    yield waitForDiscoveryNetworkIdle(page, discovery);

    yield* captureSnapshotResources(page, snapshot, {
      deviceScaleFactor: discovery.devicePixelRatio,
      mobile: true
    });
  }

  // wait for final network idle when not capturing DOM
  if (capture && snapshot.domSnapshot) {
    yield waitForDiscoveryNetworkIdle(page, discovery);
    capture(processSnapshotResources(snapshot));
  }
}

// Pushes all provided snapshots to a discovery queue with the provided callback, yielding to each
// one concurrently. When skipping asset discovery, the callback is called immediately for each
// snapshot, also processing snapshot resources when not dry-running.
export async function* discoverSnapshotResources(queue, options, callback) {
  let { snapshots, skipDiscovery, dryRun } = options;

  yield* yieldAll(snapshots.reduce((all, snapshot) => {
    debugSnapshotOptions(snapshot);

    if (skipDiscovery) {
      let { additionalSnapshots, ...baseSnapshot } = snapshot;
      additionalSnapshots = (dryRun && additionalSnapshots) || [];

      for (let snap of [baseSnapshot, ...additionalSnapshots]) {
        callback(dryRun ? snap : processSnapshotResources(snap));
      }
    } else {
      all.push(queue.push(snapshot, callback));
    }

    return all;
  }, []));
}

// Used to cache resources across core instances
const RESOURCE_CACHE_KEY = Symbol('resource-cache');

// Creates an asset discovery queue that uses the percy browser instance to create a page for each
// snapshot which is used to intercept and capture snapshot resource requests.
export function createDiscoveryQueue(percy) {
  let { concurrency } = percy.config.discovery;
  let queue = new Queue();
  let cache;

  return queue
    .set({ concurrency })
  // on start, launch the browser and run the queue
    .handle('start', async () => {
      cache = percy[RESOURCE_CACHE_KEY] = new Map();
      await percy.browser.launch();
      queue.run();
    })
  // on end, close the browser
    .handle('end', async () => {
      await percy.browser.close();
    })
  // snapshots are unique by name
    .handle('find', ({ name }, snapshot) => (
      snapshot.name === name
    ))
  // initialize the root resource for DOM snapshots
    .handle('push', snapshot => {
      let { url, domSnapshot } = snapshot;
      let root = domSnapshot && createRootResource(url, domSnapshot);
      let resources = new Map(root ? [[root.url, root]] : []);
      return { ...snapshot, resources };
    })
  // discovery resources for snapshots and call the callback for each discovered snapshot
    .handle('task', async function*(snapshot, callback) {
      percy.log.debug(`Discovering resources: ${snapshot.name}`, snapshot.meta);

      // create a new browser page
      let page = yield percy.browser.page({
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
          disallowedHostnames: snapshot.discovery.disallowedHostnames,
          getResource: u => snapshot.resources.get(u) || cache.get(u),
          saveResource: r => snapshot.resources.set(r.url, r) && cache.set(r.url, r)
        }
      });

      try {
        yield* captureSnapshotResources(page, snapshot, callback);
      } finally {
        // always close the page when done
        await page.close();
      }
    })
    .handle('error', ({ name, meta }, error) => {
      if (error.name === 'AbortError' && queue.readyState < 3) {
        // only error about aborted snapshots when not closed
        percy.log.error('Received a duplicate snapshot, ' + (
          `the previous snapshot was aborted: ${name}`), meta);
      } else {
        // log all other encountered errors
        percy.log.error(`Encountered an error taking snapshot: ${name}`, meta);
        percy.log.error(error, meta);
      }
    });
}
