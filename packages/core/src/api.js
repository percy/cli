import fs from 'fs';
import path, { dirname, resolve } from 'path';
import logger from '@percy/logger';
import { normalize } from '@percy/config/utils';
import { getPackageJSON, Server, percyAutomateRequestHandler, percyBuildEventHandler } from './utils.js';
import WebdriverUtils from '@percy/webdriver-utils';
import { handleSyncJob } from './snapshot.js';
// Previously, we used `createRequire(import.meta.url).resolve` to resolve the path to the module.
// This approach relied on `createRequire`, which is Node.js-specific and less compatible with modern ESM (ECMAScript Module) standards.
// This was leading to hard coded paths when CLI is used as a dependency in another project.
// Now, we use `fileURLToPath` and `path.resolve` to determine the absolute path in a way that's more aligned with ESM conventions.
// This change ensures better compatibility and avoids relying on Node.js-specific APIs that might cause issues in ESM environments.
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

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

// Returns a URL encoded string of nested query params
function encodeURLSearchParams(subj, prefix) {
  return typeof subj === 'object' ? Object.entries(subj).map(([key, value]) => (
    encodeURLSearchParams(value, prefix ? `${prefix}[${key}]` : key)
  )).join('&') : `${prefix}=${encodeURIComponent(subj)}`;
}

// Create a Percy CLI API server instance
export function createPercyServer(percy, port) {
  let pkg = getPackageJSON(import.meta.url);

  let server = Server.createServer({ port })
  // general middleware
    .route((req, res, next) => {
      // treat all request bodies as json
      if (req.body) try { req.body = JSON.parse(req.body); } catch {}

      // add version header
      res.setHeader('Access-Control-Expose-Headers', '*, X-Percy-Core-Version');

      // skip or change api version header in testing mode
      if (percy.testing?.version !== false) {
        res.setHeader('X-Percy-Core-Version', percy.testing?.version ?? pkg.version);
      }

      // track all api reqeusts in testing mode
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
      success: true,
      type: percy.client.tokenType()
    }))
  // get or set config options
    .route(['get', 'post'], '/percy/config', async (req, res) => res.json(200, {
      config: req.body ? percy.set(req.body) : percy.config,
      success: true
    }))
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
      return res.send(200, 'applicaton/javascript', content.concat(wrapper));
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
        const snapshotPromise = new Promise((resolve, reject) => percy.upload(req.body, { resolve, reject }, 'app'));
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
  // flushes one or more snapshots from the internal queue
    .route('post', '/percy/flush', async (req, res) => res.json(200, {
      success: await percy.flush(req.body).then(() => true)
    }))
    .route('post', '/percy/automateScreenshot', async (req, res) => {
      let data;
      percyAutomateRequestHandler(req, percy);
      let comparisonData = await WebdriverUtils.captureScreenshot(req.body);

      if (percy.syncMode(comparisonData)) {
        const snapshotPromise = new Promise((resolve, reject) => percy.upload(comparisonData, { resolve, reject }, 'automate'));
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
        logger.instance.messages.clear();
      } else if (cmd === 'version') {
        // the version command will update the api version header for testing
        percy.testing.version = body;
      } else if (cmd === 'config') {
        percy.config.snapshot.widths = body.config;
        percy.deviceDetails = body.mobile?.map((w) => { return { width: w }; });
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
      logs: Array.from(logger.instance.messages)
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
