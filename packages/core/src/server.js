import fs from 'fs';
import http from 'http';
import { Server as WSS } from 'ws';
import PercyConfig from '@percy/config';
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
      .catch(routes.catch);
  }

  // response was handled
  if (response.headersSent) return [];

  // default 404 when reply is not an array
  let [status, headers, body] = Array.isArray(reply) ? reply : [404, {}];
  // support content-type header shortcut
  if (typeof headers === 'string') headers = { 'Content-Type': headers };
  // auto stringify json
  if (headers['Content-Type']?.includes('json')) body = JSON.stringify(body);
  // add additional headers
  headers['Content-Length'] = body?.length ?? 0;
  // cors headers
  headers['Access-Control-Expose-Headers'] = 'X-Percy-Core-Version';
  headers['Access-Control-Allow-Origin'] = '*';
  // version header
  headers['X-Percy-Core-Version'] = version;

  return [status, headers, body];
}

export function createServer(routes) {
  let context = {
    version: pkg.version,

    get listening() {
      return context.server.listening;
    }
  };

  // create a simple server to route request responses
  context.routes = routes;
  context.server = http.createServer((request, response) => {
    request.on('data', chunk => {
      request.body = (request.body || '') + chunk;
    });

    request.on('end', async () => {
      try { request.body = JSON.parse(request.body); } catch (e) {}
      let [status, headers, body] = await getReply(context, request, response);
      if (!response.headersSent) response.writeHead(status, headers).end(body);
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
  context.listen = port => new Promise((resolve, reject) => {
    context.server.on('listening', () => resolve(context));
    context.server.on('error', reject);
    context.server.listen(port);
  });

  // add routes programatically
  context.reply = (url, handler) => {
    routes[url] = handler;
    return context;
  };

  return context;
}

export default function createPercyServer(percy) {
  let log = logger('core:server');

  let context = createServer({
    // healthcheck returns meta info on success
    '/percy/healthcheck': () => [200, 'application/json', {
      success: true,
      config: percy.config,
      loglevel: percy.loglevel(),
      build: percy.build
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
    '/percy/snapshot': ({ body }) => (
      percy.snapshot(PercyConfig.normalize(body))
        .then(() => [200, 'application/json', { success: true }])
    ),

    // stops the instance async at the end of the event loop
    '/percy/stop': () => setImmediate(() => percy.stop()) && (
      [200, 'application/json', { success: true }]
    ),

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
