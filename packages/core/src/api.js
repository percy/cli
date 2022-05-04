import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import logger from '@percy/logger';
import { getPackageJSON } from './utils.js';
import Server from './server.js';

// need require.resolve until import.meta.resolve can be transpiled
export const PERCY_DOM = createRequire(import.meta.url).resolve('@percy/dom');

// Create a Percy CLI API server instance
export function createPercyServer(percy, port) {
  let pkg = getPackageJSON(import.meta.url);

  return new Server({ port })
  // facilitate logger websocket connections
    .websocket('/(logger)?', ws => {
      ws.addEventListener('message', ({ data }) => {
        let { log, messages = [] } = JSON.parse(data);
        for (let m of messages) logger.instance.messages.add(m);
        if (log) logger.instance.log(...log);
      });

      ws.send(JSON.stringify({
        loglevel: logger.loglevel()
      }));
    })
  // general middleware
    .route((req, res, next) => {
      // treat all request bodies as json
      if (req.body) try { req.body = JSON.parse(req.body); } catch {}

      // add version header
      res.setHeader('Access-Control-Expose-Headers', '*, X-Percy-Core-Version');
      res.setHeader('X-Percy-Core-Version', pkg.version);

      // return json errors
      return next().catch(e => res.json(e.status ?? 500, {
        build: percy.build,
        error: e.message,
        success: false
      }));
    })
  // healthcheck returns basic information
    .route('get', '/percy/healthcheck', (req, res) => res.json(200, {
      loglevel: percy.loglevel(),
      config: percy.config,
      build: percy.build,
      success: true
    }))
  // get or set config options
    .route(['get', 'post'], '/percy/config', async (req, res) => res.json(200, {
      config: req.body ? await percy.setConfig(req.body) : percy.config,
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
        'See these docs for more info: https:docs.percy.io/docs/migrating-to-percy-cli'
      ].join(' '));

      let content = await fs.promises.readFile(PERCY_DOM, 'utf-8');
      let wrapper = '(window.PercyAgent = class { snapshot(n, o) { return PercyDOM.serialize(o); } });';
      return res.send(200, 'applicaton/javascript', content.concat(wrapper));
    })
  // post one or more snapshots
    .route('post', '/percy/snapshot', async (req, res) => {
      let snapshot = percy.snapshot(req.body);
      if (!req.url.searchParams.has('async')) await snapshot;
      return res.json(200, { success: true });
    })
  // stops percy at the end of the current event loop
    .route('/percy/stop', (req, res) => {
      setImmediate(() => percy.stop());
      return res.json(200, { success: true });
    });
}

// Create a static server instance with an automatic sitemap
export function createStaticServer(options) {
  let { serve, port, baseUrl = '/', ...opts } = options;
  let server = new Server({ port }).serve(baseUrl, serve, opts);

  // used when generating an automatic sitemap
  let toURL = Server.createRewriter((
    // reverse rewrites' src, dest, & order
    Object.entries(options?.rewrites ?? {})
      .reduce((acc, rw) => [rw.reverse(), ...acc], [])
  ), (filename, rewrite) => new URL(path.posix.join(baseUrl, (
    // cleanUrls will trim trailing .html/index.html from paths
    !options.cleanUrls ? rewrite(filename) : (
      rewrite(filename).replace(/(\/index)?\.html$/, ''))
  )), server.address()));

  // include automatic sitemap route
  server.route('get', '/sitemap.xml', async (req, res) => {
    let { default: glob } = await import('fast-glob');
    let files = await glob('**/*.html', { cwd: serve, fs });

    return res.send(200, 'application/xml', [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
      ...files.map(name => `  <url><loc>${toURL(name)}</loc></url>`),
      '</urlset>'
    ].join('\n'));
  });

  return server;
}
