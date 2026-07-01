import fs from 'fs';
import path, { dirname, resolve } from 'path';
import logger from '@percy/logger';
import { normalize } from '@percy/config/utils';
import { getPackageJSON, Server, percyAutomateRequestHandler, percyBuildEventHandler, computeResponsiveWidths, encodeURLSearchParams } from './utils.js';
import WebdriverUtils from '@percy/webdriver-utils';
import { handleSyncJob } from './snapshot.js';
import { getMaestroHierarchyDrift } from './maestro-hierarchy.js';
import { handleComparisonUpload } from './comparison-upload.js';
import { handleMaestroScreenshot } from './maestro-screenshot.js';
// Previously, we used `createRequire(import.meta.url).resolve` to resolve the path to the module.
// This approach relied on `createRequire`, which is Node.js-specific and less compatible with modern ESM (ECMAScript Module) standards.
// This was leading to hard coded paths when CLI is used as a dependency in another project.
// Now, we use `fileURLToPath` and `path.resolve` to determine the absolute path in a way that's more aligned with ESM conventions.
// This change ensures better compatibility and avoids relying on Node.js-specific APIs that might cause issues in ESM environments.
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { configSchema } from './config.js';

export const getPercyDomPath = (url) => {
  try {
    return createRequire(url).resolve('@percy/dom');
  } catch (error) {
    logger('core:server').warn([
      'Failed to resolve @percy/dom path using createRequire.',
      'Falling back to using fileURLToPath and path.resolve.'
    ].join(' '));
  }
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  return resolve(__dirname, 'node_modules/@percy/dom');
};

// Resolved path for PERCY_DOM
export const PERCY_DOM = getPercyDomPath(import.meta.url);

// Walks the config schema and collects dot-paths of any fields marked `httpReadOnly: true`
// that are present in `body`. Driving this from the schema means new HTTP-blocked fields
// only need a one-line annotation next to their definition — no list to keep in sync here.
function findHttpReadOnlyPaths(body, schema, path = '') {
  if (!body || typeof body !== 'object' || !schema?.properties) return [];
  let paths = [];
  for (let [key, propSchema] of Object.entries(schema.properties)) {
    if (!Object.prototype.hasOwnProperty.call(body, key)) continue;
    let childPath = path ? `${path}.${key}` : key;
    if (propSchema?.httpReadOnly) {
      paths.push(childPath);
    } else {
      paths.push(...findHttpReadOnlyPaths(body[key], propSchema, childPath));
    }
  }
  return paths;
}

// Top-level configSchema is a map of subschemas keyed by top-level config namespace
// (`discovery`, `snapshot`, …). Wrap it as a single object schema so the walker can recurse
// uniformly from the root.
const ROOT_CONFIG_SCHEMA = { type: 'object', properties: configSchema };

// Removes each dot-path's leaf from a deep clone of `body` and logs a warning per path.
// Returns the original `body` unchanged when `paths` is empty so we don't pay for a clone
// on every config request. Exported for unit testing: the `?.` chain in the reduce is a
// defensive guard for paths whose ancestor is absent from `body`. Through the production
// caller (stripBlockedConfigFields → findHttpReadOnlyPaths) every intermediate is verified
// present, so the guard is unreachable in normal use — but the explicit paths parameter
// lets a unit test exercise it without contorting the schema.
export function _applyHttpReadOnlyStripping(body, paths, log) {
  if (!paths.length) return body;

  let stripped = JSON.parse(JSON.stringify(body));
  for (let p of paths) {
    let parts = p.split('.');
    let leaf = parts.pop();
    let parent = parts.reduce((o, k) => o?.[k], stripped);
    if (parent && typeof parent === 'object') delete parent[leaf];
    log.warn(`Ignoring \`${p}\` from /percy/config request: this field can only be set via the config file or CLI at startup.`);
  }
  return stripped;
}

// Returns a body with `httpReadOnly` fields removed. Caller guarantees `body` is truthy.
function stripBlockedConfigFields(body, log) {
  return _applyHttpReadOnlyStripping(body, findHttpReadOnlyPaths(body, ROOT_CONFIG_SCHEMA), log);
}

// Create a Percy CLI API server instance
export function createPercyServer(percy, port) {
  let pkg = getPackageJSON(import.meta.url);

  let server = Server.createServer({ port })
  // general middleware
    .route((req, res, next) => {
      // treat all request bodies as json (skip for multipart form data)
      let contentType = req.headers['content-type'] || '';
      if (req.body && !contentType.startsWith('multipart/form-data')) {
        try { req.body = JSON.parse(req.body); } catch {}
      }

      // add version header
      res.setHeader('Access-Control-Expose-Headers', '*, X-Percy-Core-Version');

      // skip or change api version header in testing mode
      if (percy.testing?.version !== false) {
        res.setHeader('X-Percy-Core-Version', percy.testing?.version ?? pkg.version);
      }

      // track all api requests in testing mode
      if (percy.testing && !req.url.pathname.startsWith('/test/')) {
        (percy.testing.requests ||= []).push({
          url: `${req.url.pathname}${req.url.search}`,
          method: req.method,
          body: req.body
        });
      }

      // support sabotaging requests in testing mode
      if (percy.testing?.api?.[req.url.pathname] === 'error') {
        next = () => Promise.reject(new Error(percy.testing.build?.error || 'testing'));
      } else if (percy.testing?.api?.[req.url.pathname] === 'disconnect') {
        next = () => req.connection.destroy();
      }

      // return json errors
      return next().catch(e => res.json(e.status ?? 500, {
        build: percy.testing?.build || percy.build,
        error: e.message,
        success: false
      }));
    })
  // healthcheck returns basic information
    .route('get', '/percy/healthcheck', (req, res) => res.json(200, {
      build: percy.testing?.build ?? percy.build,
      loglevel: percy.loglevel(),
      config: percy.config,
      widths: {
        // This is always needed even if width is passed
        mobile: percy.deviceDetails ? percy.deviceDetails.map((d) => d.width) : [],
        // This will only be used if width is not passed in options
        config: percy.config.snapshot.widths
      },
      deviceDetails: percy.deviceDetails || [],
      // Two-slot drift envelope (Unit 4). Always emitted; both slots null
      // in steady state. Ops uses this to detect Maestro upstream wire-format
      // contract drift that would silently degrade element-region resolution.
      // android slot is reserved for future Android-resolver schema-class
      // calls (PR #2210's gRPC drift surface retrofits to use this setter).
      maestroHierarchyDrift: getMaestroHierarchyDrift(),
      success: true,
      type: percy.client.tokenType()
    }))
  // compute widths configuration with heights
    .route('get', '/percy/widths-config', (req, res) => {
      // Parse widths from query parameters (e.g., ?widths=375,1280)
      const widthsParam = req.url.searchParams.get('widths');
      const userPassedWidths = widthsParam ? widthsParam.split(',').map(w => parseInt(w.trim(), 10)).filter(w => !isNaN(w)) : [];

      const eligibleWidths = {
        mobile: percy.deviceDetails ? percy.deviceDetails.map((d) => d.width) : [],
        config: percy.config.snapshot.widths
      };
      const deviceDetails = percy.deviceDetails || [];

      const widths = computeResponsiveWidths(userPassedWidths, eligibleWidths, deviceDetails);

      return res.json(200, {
        widths,
        success: true
      });
    })
  // get or set config options
    .route(['get', 'post'], '/percy/config', async (req, res) => {
      let body = req.body && stripBlockedConfigFields(req.body, logger('core:server'));
      return res.json(200, {
        config: body ? percy.set(body) : percy.config,
        success: true
      });
    })
  // responds once idle (may take a long time)
    .route('get', '/percy/idle', async (req, res) => res.json(200, {
      success: await percy.idle().then(() => true)
    }))
  // convenient @percy/dom bundle
    .route('get', '/percy/dom.js', (req, res) => {
      return res.file(200, PERCY_DOM);
    })
  // legacy agent wrapper for @percy/dom
    .route('get', '/percy-agent.js', async (req, res) => {
      logger('core:server').deprecated([
        'It looks like you’re using @percy/cli with an older SDK.',
        'Please upgrade to the latest version to fix this warning.',
        'See these docs for more info: https://www.browserstack.com/docs/percy/migration/migrate-to-cli'
      ].join(' '));

      let content = await fs.promises.readFile(PERCY_DOM, 'utf-8');
      let wrapper = '(window.PercyAgent = class { snapshot(n, o) { return PercyDOM.serialize(o); } });';
      return res.send(200, 'application/javascript', content.concat(wrapper));
    })
  // post one or more snapshots, optionally async
    .route('post', '/percy/snapshot', async (req, res) => {
      let data;
      const snapshotPromise = {};
      const snapshot = percy.snapshot(req.body, snapshotPromise);
      if (!req.url.searchParams.has('async')) await snapshot;

      if (percy.syncMode(req.body)) data = await handleSyncJob(snapshotPromise[req.body.name], percy, 'snapshot');

      return res.json(200, { success: true, data: data });
    })
  // post one or more comparisons, optionally waiting
    .route('post', '/percy/comparison', async (req, res) => {
      let data;
      if (percy.syncMode(req.body)) {
        // percy.upload() is the generatePromise-wrapped method: calling it drives the
        // underlying async generator to completion (enqueuing #snapshots) and the sync
        // queue resolves/rejects the attached callback. Do NOT `for await` the return
        // value — it is a Promise, not an async iterable. The raw generator lives at
        // percy.yield.upload() if direct iteration is ever needed. The trailing
        // .catch(reject) surfaces generator errors that bypass the sync-queue callback
        // (e.g. a throw before the queue task runs) instead of leaking an unhandled
        // rejection and hanging the request.
        const snapshotPromise = new Promise((resolve, reject) => {
          percy.upload(req.body, { resolve, reject }, 'app').catch(reject);
        });
        data = await handleSyncJob(snapshotPromise, percy, 'comparison');
      } else {
        let upload = percy.upload(req.body, null, 'app');
        if (req.url.searchParams.has('await')) await upload;
      }

      // generate and include one or more redirect links to comparisons
      let link = ({ name, tag }) => [
        percy.client.apiUrl, '/comparisons/redirect?',
        encodeURLSearchParams(normalize({
          buildId: percy.build?.id, snapshot: { name }, tag
        }, { snake: true }))
      ].join('');

      const response = { success: true, data: data };
      if (req.body) {
        if (Array.isArray(req.body)) {
          response.links = req.body.map(link);
        } else {
          response.link = link(req.body);
        }
      }
      return res.json(200, response);
    })
  // post a comparison via multipart file upload
    .route('post', '/percy/comparison/upload', /* istanbul ignore next */ (req, res) => handleComparisonUpload(req, res, percy))
  // post a comparison by reading a Maestro screenshot from disk
    .route('post', '/percy/maestro-screenshot', (req, res) => handleMaestroScreenshot(req, res, percy))
  // flushes one or more snapshots from the internal queue
    .route('post', '/percy/flush', async (req, res) => res.json(200, {
      success: await percy.flush(req.body).then(() => true)
    }))
    .route('post', '/percy/automateScreenshot', async (req, res) => {
      let data;
      percyAutomateRequestHandler(req, percy);
      let comparisonData = await WebdriverUtils.captureScreenshot(req.body);

      if (percy.syncMode(comparisonData)) {
        // See the /percy/comparison route: percy.upload() is the Promise-wrapped method;
        // calling it drives the generator and the sync queue resolves/rejects the callback.
        // The .catch(reject) surfaces generator errors that bypass that callback.
        const snapshotPromise = new Promise((resolve, reject) => {
          percy.upload(comparisonData, { resolve, reject }, 'automate').catch(reject);
        });
        data = await handleSyncJob(snapshotPromise, percy, 'comparison');
      } else {
        percy.upload(comparisonData, null, 'automate');
      }

      res.json(200, { success: true, data: data });
    })
  // Receives events from sdk's.
    .route('post', '/percy/events', async (req, res) => {
      const body = percyBuildEventHandler(req, pkg.version);
      await percy.client.sendBuildEvents(percy.build?.id, body);
      res.json(200, { success: true });
    })
    .route('post', '/percy/log', async (req, res) => {
      const log = logger('sdk');
      if (!req.body) {
        log.error('No request body for /percy/log endpoint');
        return res.json(400, { error: 'No body passed' });
      }
      const level = req.body.level;
      const message = req.body.message;
      const meta = req.body.meta || {};

      log[level](message, meta);

      res.json(200, { success: true });
    })
  // stops percy at the end of the current event loop
    .route('/percy/stop', (req, res) => {
      setImmediate(() => percy.stop());
      return res.json(200, { success: true });
    });

  // add test endpoints only in testing mode
  return !percy.testing ? server : server
  // manipulates testing mode configuration to trigger specific scenarios
    .route('/test/api/:cmd', ({ body, params: { cmd } }, res) => {
      body = Buffer.isBuffer(body) ? body.toString() : body;

      if (cmd === 'reset') {
        // the reset command will reset testing mode and clear any logs
        percy.testing = {};
        logger.instance.reset();
      } else if (cmd === 'version') {
        // the version command will update the api version header for testing
        percy.testing.version = body;
      } else if (cmd === 'config') {
        percy.config.snapshot.widths = body.config;
        // Support setting deviceDetails directly or deriving from mobile widths
        percy.deviceDetails = body.deviceDetails || body.mobile?.map((w) => { return { width: w }; });
        percy.config.snapshot.responsiveSnapshotCapture = !!body.responsive;
        percy.config.percy.deferUploads = !!body.deferUploads;
      } else if (cmd === 'error' || cmd === 'disconnect') {
        // the error or disconnect commands will cause specific endpoints to fail
        (percy.testing.api ||= {})[body] = cmd;
      } else if (cmd === 'build-failure') {
        // the build-failure command will cause api errors to include a failed build
        percy.testing.build = { failed: true, error: 'Build failed' };
      } else if (cmd === 'build-created') {
        // the build-failure command will cause api errors to include a failed build
        percy.testing.build = { id: '123', url: 'https://percy.io/test/test/123' };
      } else {
        // 404 for unknown commands
        return res.send(404);
      }

      return res.json(200, { success: true });
    })
  // returns an array of raw requests made to the api
    .route('get', '/test/requests', (req, res) => res.json(200, {
      requests: percy.testing.requests
    }))
  // returns an array of raw logs from the logger
    .route('get', '/test/logs', (req, res) => res.json(200, {
      logs: logger.instance.query(() => true)
    }))
  // serves a very basic html page for testing snapshots
    .route('get', '/test/snapshot', (req, res) => {
      return res.send(200, 'text/html', '<p>Snapshot Me!</p>');
    });
}

// Create a static server instance with an automatic sitemap
export function createStaticServer(options) {
  let { serve: dir, baseUrl = '' } = options;
  let server = Server.createServer(options);

  // remove trailing slashes so the base snapshot name matches other snapshots
  baseUrl = baseUrl.replace(/\/$/, '');

  // used when generating an automatic sitemap
  let toURL = Server.createRewriter((
    // reverse rewrites' src, dest, & order
    Object.entries(options?.rewrites ?? {})
      .reduce((acc, rw) => [rw.reverse(), ...acc], [])
  ), (filename, rewrite) => new URL(path.posix.join('/', baseUrl, (
    // cleanUrls will trim trailing .html/index.html from paths
    !options.cleanUrls ? rewrite(filename) : (
      rewrite(filename).replace(/(\/index)?\.html$/, ''))
  )), server.address()));

  // include automatic sitemap route
  server.route('get', `${baseUrl}/sitemap.xml`, async (req, res) => {
    let { default: glob } = await import('fast-glob');
    let files = await glob('**/*.html', { cwd: dir, fs });

    return res.send(200, 'application/xml', [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
      ...files.map(name => `  <url><loc>${toURL(name)}</loc></url>`),
      '</urlset>'
    ].join('\n'));
  });

  return server;
}
