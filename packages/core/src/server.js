import fs from 'fs';
import path from 'path';
import http from 'http';
import mime from 'mime-types';
import disposition from 'content-disposition';
import {
  pathToRegexp,
  match as pathToMatch,
  compile as makeToPath
} from 'path-to-regexp';

// custom incoming message adds a `url` and `body` properties containing the parsed URL and message
// buffer respectively; both available after the 'end' event is emitted
export class IncomingMessage extends http.IncomingMessage {
  constructor(socket) {
    let buffer = [];

    super(socket).on('data', d => buffer.push(d)).on('end', () => {
      this.url = new URL(this.url, `http://${this.headers.host}`);
      if (buffer.length) this.body = Buffer.concat(buffer);

      if (this.body && this.headers['content-type']?.includes('json')) {
        try { this.body = JSON.parse(this.body); } catch {}
      }
    });
  }
}

// custom server response adds additional convenience methods
export class ServerResponse extends http.ServerResponse {
  // responds with a status, headers, and body; the second argument can be an content-type string,
  // or a headers object, with content-length being automatically set when a `body` is provided
  send(status, headers, body) {
    if (typeof headers === 'string') {
      this.setHeader('Content-Type', headers);
      headers = null;
    }

    if (body != null && !this.hasHeader('Content-Length')) {
      this.setHeader('Content-Length', Buffer.byteLength(body));
    }

    return this.writeHead(status, headers).end(body);
  }

  // responds with a status and content with a plain/text content-type
  text(status, content) {
    if (arguments.length < 2) [status, content] = [200, status];
    return this.send(status, 'text/plain', content.toString());
  }

  // responds with a status and stringified `data` with a json content-type
  json(status, data) {
    if (arguments.length < 2) [status, data] = [200, status];
    return this.send(status, 'application/json', JSON.stringify(data));
  }

  // responds with a status and streams a file with appropriate headers
  file(status, filepath) {
    if (arguments.length < 2) [status, filepath] = [200, status];

    filepath = path.resolve(filepath);
    let { size } = fs.lstatSync(filepath);
    let range = parseByteRange(this.req.headers.range, size);

    // support simple range requests
    if (this.req.headers.range) {
      let byteRange = range ? `${range.start}-${range.end}` : '*';
      this.setHeader('Content-Range', `bytes ${byteRange}/${size}`);
      if (!range) return this.send(416);
    }

    this.writeHead(range ? 206 : status, {
      'Accept-Ranges': 'bytes',
      'Content-Type': mime.contentType(path.extname(filepath)),
      'Content-Length': range ? (range.end - range.start + 1) : size,
      'Content-Disposition': disposition(filepath, { type: 'inline' })
    });

    fs.createReadStream(filepath, range).pipe(this);
    return this;
  }
}

// custom server error with a status and default reason
export class ServerError extends Error {
  static throw(status, reason) {
    throw new this(status, reason);
  }

  constructor(status = 500, reason) {
    super(reason || http.STATUS_CODES[status]);
    this.status = status;
  }
}

// custom server class handles routing requests and provides alternate methods and properties
export class Server extends http.Server {
  #sockets = new Set();
  #defaultPort;

  constructor({ port } = {}) {
    super({ IncomingMessage, ServerResponse });
    this.#defaultPort = port;

    // handle requests on end
    this.on('request', (req, res) => {
      req.on('end', () => this.#handleRequest(req, res));
    });
    // track open connections to terminate when the server closes
    this.on('connection', socket => {
      let handleClose = () => this.#sockets.delete(socket);
      this.#sockets.add(socket.on('close', handleClose));
    });
  }

  // return the listening port or any default port
  get port() {
    return super.address()?.port ?? this.#defaultPort;
  }

  // return a string representation of the server address
  address() {
    let port = this.port;
    let host = 'http://localhost';
    return port ? `${host}:${port}` : host;
  }

  // return a promise that resolves when the server is listening
  listen(port = this.#defaultPort) {
    return new Promise((resolve, reject) => {
      let handle = err => off() && err ? reject(err) : resolve(this);
      let off = () => this.off('error', handle).off('listening', handle);
      super.listen(port, handle).once('error', handle);
    });
  }

  // return a promise that resolves when the server closes
  close() {
    return new Promise(resolve => {
      this.#sockets.forEach(socket => socket.destroy());
      super.close(resolve);
    });
  }

  // initial routes include cors and 404 handling
  #routes = [{
    priority: -1,
    handle: (req, res, next) => {
      res.setHeader('Access-Control-Allow-Origin', '*');

      if (req.method === 'OPTIONS') {
        let allowHeaders = req.headers['access-control-request-headers'] || '*';
        let allowMethods = [...new Set(this.#routes.flatMap(route => (
          (!route.match || route.match(req.url.pathname)) && route.methods
        ) || []))].join(', ');

        res.setHeader('Access-Control-Allow-Headers', allowHeaders);
        res.setHeader('Access-Control-Allow-Methods', allowMethods);
        res.writeHead(204).end();
      } else {
        res.setHeader('Access-Control-Expose-Headers', '*');
        return next();
      }
    }
  }, {
    priority: 3,
    handle: (req) => ServerError.throw(404)
  }];

  // adds a route in the correct priority order
  #route(route) {
    let i = this.#routes.findIndex(r => r.priority >= route.priority);
    this.#routes.splice(i, 0, route);
    return this;
  }

  // set request routing and handling for pathnames and methods
  route(method, pathname, handle) {
    if (arguments.length === 1) [handle, method] = [method];
    if (arguments.length === 2) [handle, pathname] = [pathname];
    if (arguments.length === 2 && !Array.isArray(method) &&
        method[0] === '/') [pathname, method] = [method];

    return this.#route({
      priority: !pathname ? 0 : !method ? 1 : 2,
      methods: method && [].concat(method).map(m => m.toUpperCase()),
      match: pathname && pathToMatch(pathname),
      handle
    });
  }

  // install a route that serves requested files from the provided directory
  serve(pathname, directory, options) {
    if (typeof directory !== 'string') [options, directory] = [directory];
    if (!directory) [pathname, directory] = ['/', pathname];

    let root = path.resolve(directory);
    if (!fs.existsSync(root)) throw new Error(`Not found: ${directory}`);

    let mountPattern = pathToRegexp(pathname, null, { end: false });
    let rewritePath = createRewriter(options?.rewrites, (pathname, rewrite) => {
      try {
        let filepath = decodeURIComponent(pathname.replace(mountPattern, ''));
        if (!isPathInside(root, filepath)) ServerError.throw();
        return rewrite(filepath);
      } catch {
        throw new ServerError(400);
      }
    });

    return this.#route({
      priority: 2,
      methods: ['GET'],
      match: pathname => mountPattern.test(pathname),
      handle: async (req, res, next) => {
        try {
          let pathname = rewritePath(req.url.pathname);
          let file = await getFile(root, pathname, options?.cleanUrls);
          if (!file?.stats.isFile()) return await next();
          return res.file(file.path);
        } catch (err) {
          let statusPage = path.join(root, `${err.status}.html`);
          if (!fs.existsSync(statusPage)) throw err;
          return res.file(err.status, statusPage);
        }
      }
    });
  }

  // route and respond to requests; handling errors if necessary
  async #handleRequest(req, res) {
    // support node < 15.7.0
    res.req ??= req;

    try {
      // invoke routes like middleware
      await (async function cont(routes, i = 0) {
        let next = () => cont(routes, i + 1);
        let { methods, match, handle } = routes[i];
        let result = !methods || methods.includes(req.method);
        result &&= !match || match(req.url.pathname);
        if (result) req.params = result.params;
        return result ? handle(req, res, next) : next();
      })(this.#routes);
    } catch (error) {
      let { status = 500, message } = error;

      // fallback error handling
      if (req.headers.accept?.includes('json') ||
          req.headers['content-type']?.includes('json')) {
        res.json(status, { error: message });
      } else {
        res.text(status, message);
      }
    }
  }
}

// create a url rewriter from provided rewrite rules
function createRewriter(rewrites = [], cb) {
  let normalize = p => path.posix.normalize(path.posix.join('/', p));
  if (!Array.isArray(rewrites)) rewrites = Object.entries(rewrites);

  let rewrite = [{
    // resolve and normalize the path before rewriting
    apply: p => path.posix.resolve(normalize(p))
  }].concat(rewrites.map(([src, dest]) => {
    // compile rewrite rules into functions
    let match = pathToMatch(normalize(src));
    let toPath = makeToPath(normalize(dest));
    return { match, apply: r => toPath(r.params) };
  })).reduceRight((next, rule) => pathname => {
    // compose all rewrites into a single function
    let result = rule.match?.(pathname) ?? pathname;
    if (result) pathname = rule.apply(result);
    return next(pathname);
  }, p => p);

  // allow additional pathname processing around the rewriter
  return p => cb(p, rewrite);
}

// returns true if the pathname is inside the root pathname
function isPathInside(root, pathname) {
  let abs = path.resolve(path.join(root, pathname));

  return !abs.lastIndexOf(root, 0) && (
    abs[root.length] === path.sep || !abs[root.length]
  );
}

// get the absolute path and stats of a possible file
async function getFile(root, pathname, cleanUrls) {
  for (let filename of [pathname].concat(
    cleanUrls ? path.join(pathname, 'index.html') : [],
    cleanUrls && pathname.length > 2 ? pathname.replace(/\/?$/, '.html') : []
  )) {
    let filepath = path.resolve(path.join(root, filename));
    let stats = await fs.promises.lstat(filepath).catch(() => {});
    if (stats?.isFile()) return { path: filepath, stats };
  }
}

// returns the start and end of a byte range or undefined if unable to parse
const RANGE_REGEXP = /^bytes=(\d*)?-(\d*)?(?:\b|$)/;

function parseByteRange(range, size) {
  let [, start, end = size] = range?.match(RANGE_REGEXP) ?? [0, 0, 0];
  start = Math.max(parseInt(start, 10), 0);
  end = Math.min(parseInt(end, 10), size - 1);
  if (isNaN(start)) [start, end] = [size - end, size - 1];
  if (start >= 0 && start < end) return { start, end };
}

// shorthand function for creating a new server with specific options
export function createServer(options = {}) {
  let { serve, port, baseUrl = '/', ...opts } = options;
  let server = new Server({ port });

  return serve ? (
    server.serve(baseUrl, serve, opts)
  ) : server;
}

// include some exports as static properties
Server.Error = ServerError;
Server.createRewriter = createRewriter;
Server.createServer = createServer;
export default Server;
