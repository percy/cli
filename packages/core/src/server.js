import http from 'http';
import fs from 'fs';

async function getReply(routes, request) {
  let route = routes[request.url] || routes.default;
  let reply;

  // cors preflight
  if (request.method === 'OPTIONS') {
    reply = [204, { 'Access-Control-Allow-Methods': 'GET,POST' }];
  } else {
    reply = await Promise.resolve()
      .then(() => routes.middleware?.(request))
      .then(() => route?.(request))
      .catch(routes.catch);
  }

  // default 404 when reply is not an array
  let [status, headers, body] = Array.isArray(reply) ? reply : [404, {}];
  // support content-type header shortcut
  if (typeof headers === 'string') headers = { 'Content-Type': headers };
  // auto stringify json
  if (headers['Content-Type']?.includes('json')) body = JSON.stringify(body);
  // add content length and cors headers
  headers['Content-Length'] = body?.length ?? 0;
  headers['Access-Control-Allow-Origin'] = '*';

  return [status, headers, body];
}

export function createServer(routes) {
  let context = {
    get listening() {
      return context.server.listening;
    }
  };

  context.server = http.createServer((request, response) => {
    request.on('data', chunk => {
      request.body = (request.body || '') + chunk;
    });

    request.on('end', async () => {
      try { request.body = JSON.parse(request.body); } catch {}
      let [status, headers, body] = await getReply(routes, request);
      response.writeHead(status, headers).end(body);
    });
  });

  context.close = () => context.server.close();
  context.listen = port => new Promise((resolve, reject) => {
    context.server.on('listening', () => resolve(context));
    context.server.on('error', reject);
    context.server.listen(port);
  });

  context.reply = (url, handler) => {
    routes[url] = handler;
    return context;
  };

  return context;
}

export default function createPercyServer(percy) {
  return createServer({
    // healthcheck returns meta info on success
    '/percy/healthcheck': () => [200, 'application/json', {
      success: true,
      config: percy.config,
      loglevel: percy.loglevel(),
      build: percy.client.build
    }],

    // responds when idle
    '/percy/idle': () => percy.idle()
      .then(() => [200, 'application/json', { success: true }]),

    // serves @percy/dom as a convenience
    '/percy/dom.js': () => fs.promises
      .readFile(require.resolve('@percy/dom'), 'utf-8')
      .then(content => [200, 'applicaton/javascript', content]),

    // forward snapshot requests
    '/percy/snapshot': ({ body }) => percy.snapshot(body)
      .then(() => [200, 'application/json', { success: true }]),

    // stops the instance
    '/percy/stop': () => percy.stop()
      .then(() => [200, 'application/json', { success: true }]),

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
}
