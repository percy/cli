import fs from 'fs';
import path from 'path';
import http from 'http';
import glob from 'fast-glob';
import mime from 'mime-types';
import disposition from 'content-disposition';
import * as pathToRegexp from 'path-to-regexp';
import { Server as WSS } from 'ws';
import logger from '@percy/logger';
import pkg from '../package.json';

async function getReply({ version, routes }, request, response) {
  let [url] = request.url.split('?');
  let route = routes[url] || routes.default;
  let reply;

  // cors preflight
  if (request.method === 'OPTIONS') {
    reply = [204, {}];
    reply[1]['Access-Control-Allow-Methods'] = 'GET,POST,OPTIONS';
    reply[1]['Access-Control-Request-Headers'] = 'Vary';
    let allowed = request.headers['access-control-request-headers'];
    if (allowed?.length) reply[1]['Access-Control-Allow-Headers'] = allowed;
  } else {
    reply = await Promise.resolve()
      .then(() => routes.middleware?.(request, response))
      .then(() => route?.(request, response))
      .catch(e => routes.catch?.(e, request, response));
  }

  // response was handled
  if (response.headersSent) return [];

  // default 404 when reply is not a tuple
  if (!Array.isArray(reply)) reply = [404, {}];

  // support alternate reply tuples
  let [status, headers, body] = (typeof reply[1] === 'string') ? (
    (reply.length === 2 && fs.existsSync(reply[1]))
      // [status, filepath]
      ? await getStreamResponse(reply, request)
      // [status, headers[Content-Type], body]
      : [reply[0], { 'Content-Type': reply[1] }, reply[2]];
      // [status, headers, body]
  ) : reply;

  if (reply.length > 2) {
    // auto stringify json and get content length
    if (headers['Content-Type']?.includes('json')) body = JSON.stringify(body);
    headers['Content-Length'] ??= body.length;
  }

  // cors headers
  headers['Access-Control-Expose-Headers'] = 'X-Percy-Core-Version';
  headers['Access-Control-Allow-Origin'] = '*';
  // version header
  headers['X-Percy-Core-Version'] = version;

  return [status, headers, body];
}

const RANGE_REGEXP = /^bytes=(\d*?)-(\d*?)(\b|$)/;
async function getStreamResponse([status, filepath], request) {
  let { size } = await fs.promises.lstat(filepath);
  let basename = path.basename(filepath);
  let headers = {};
  let range;

  // support simple byte range requests
  if (size && request.headers.range) {
    let [, start, end] = request.headers.range.match(RANGE_REGEXP) ?? [];
    end = Math.min(end ? parseInt(end, 10) : size, size - 1);
    start = Math.max(start ? parseInt(start, 10) : size - end, 0);
    range = start >= 0 && start < end && { start, end };
    headers['Content-Range'] = `bytes ${range ? `${start}-${end}` : '*'}/${size}`;
    status = range ? 206 : 416;
  }

  // necessary file headers
  headers['Accept-Ranges'] = 'bytes';
  headers['Content-Type'] = mime.contentType(basename);
  headers['Content-Length'] = range ? (range.end - range.start + 1) : size;
  headers['Content-Disposition'] = disposition(basename, { type: 'inline' });

  // create read stream between any requested range
  let body = fs.createReadStream(filepath, range);
  return [status, headers, body];
}

export function createServer(routes, defport) {
  let context = {
    version: pkg.version,

    get listening() {
      return context.server.listening;
    }
  };

  // create a simple server to route request responses
  context.routes = routes;
  context.server = http.createServer((request, response) => {
    request.params = new URLSearchParams(request.url.split('?')[1]);

    request.on('data', chunk => {
      request.body = (request.body || '') + chunk;
    });

    request.on('end', async () => {
      try { request.body = JSON.parse(request.body); } catch (e) {}
      let [status, headers, body] = await getReply(context, request, response);

      if (!response.headersSent) {
        response.writeHead(status, headers);
        if (typeof body?.pipe === 'function') body.pipe(response);
        else response.end(body);
      }
    });
  });

  // track connections
  context.sockets = new Set();
  context.server.on('connection', s => {
    context.sockets.add(s.on('close', () => context.sockets.delete(s)));
  });

  // immediately kill connections on close
  context.close = () => new Promise(resolve => {
    context.sockets.forEach(s => s.destroy());
    context.server.close(resolve);
  });

  // starts the server
  context.listen = (port = defport) => new Promise((resolve, reject) => {
    context.server.on('listening', resolve);
    context.server.on('error', reject);
    context.server.listen(port);
  }).then(() => {
    let addr = context.server.address();
    context.address += `:${addr.port}`;
    context.port = addr.port;
    return context;
  });

  // add routes programatically
  context.reply = (url, handler) => {
    routes[url] = handler;
    return context;
  };

  context.address = 'http://localhost';
  return context;
}

export function createPercyServer(percy) {
  let log = logger('core:server');

  let context = createServer({
    // healthcheck returns meta info on success
    '/percy/healthcheck': () => [200, 'application/json', {
      success: true,
      config: percy.config,
      loglevel: percy.loglevel(),
      build: percy.build
    }],

    // remotely get and set percy config options
    '/percy/config': ({ body }) => [200, 'application/json', {
      config: body ? percy.setConfig(body) : percy.config,
      success: true
    }],

    // responds when idle
    '/percy/idle': () => percy.idle()
      .then(() => [200, 'application/json', { success: true }]),

    // serves @percy/dom as a convenience
    '/percy/dom.js': () => fs.promises
      .readFile(require.resolve('@percy/dom'), 'utf-8')
      .then(content => [200, 'applicaton/javascript', content]),

    // serves the new DOM library, wrapped for compatability to `@percy/agent`
    '/percy-agent.js': () => fs.promises
      .readFile(require.resolve('@percy/dom'), 'utf-8')
      .then(content => {
        let wrapper = '(window.PercyAgent = class PercyAgent { snapshot(n, o) { return PercyDOM.serialize(o); } });';
        log.deprecated('It looks like you’re using @percy/cli with an older SDK. Please upgrade to the latest version' + (
          ' to fix this warning. See these docs for more info: https://docs.percy.io/docs/migrating-to-percy-cli'));
        return [200, 'applicaton/javascript', content.concat(wrapper)];
      }),

    // forward snapshot requests
    '/percy/snapshot': async ({ body, params }) => {
      let snapshot = percy.snapshot(body);
      if (!params.has('async')) await snapshot;
      return [200, 'application/json', { success: true }];
    },

    // stops the instance async at the end of the event loop
    '/percy/stop': () => {
      setImmediate(async () => await percy.stop());
      return [200, 'application/json', { success: true }];
    },

    // other routes 404
    default: () => [404, 'application/json', {
      error: 'Not found',
      success: false
    }],

    // generic error handler
    catch: ({ message }) => [500, 'application/json', {
      error: message,
      success: false
    }]
  });

  // start a websocket server
  context.wss = new WSS({ noServer: true });

  // manually handle upgrades to avoid wss handling all events
  context.server.on('upgrade', (req, sock, head) => {
    context.wss.handleUpgrade(req, sock, head, socket => {
      // allow remote logging connections
      let disconnect = logger.connect(socket);
      socket.once('close', () => disconnect());
    });
  });

  return context;
}

export default createPercyServer;
