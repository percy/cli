import utils from '@percy/sdk-utils';
import https from 'https';
import http from 'http';
import fs from 'fs';

const ssl = {
  cert: fs.readFileSync(`${__dirname}/assets/certs/test.crt`),
  key: fs.readFileSync(`${__dirname}/assets/certs/test.key`)
};

// Returns the port number of a URL object. Defaults to port 443 for https
// protocols or port 80 otherwise.
function port(options) {
  if (options.port) return options.port;
  return options.protocol === 'https:' ? 443 : 80;
}

// Returns a string representation of a URL-like object
function href(options) {
  let { protocol, hostname, path, pathname, search, hash } = options;
  return `${protocol}//${hostname}:${port(options)}` +
    (path || `${pathname || ''}${search || ''}${hash || ''}`);
};

function createTestServer({ type = 'http', ...options } = {}, handler) {
  let { createServer } = type === 'http' ? http : https;
  let connections = new Set();
  let received = [];

  let url = new URL(href({
    protocol: `${type}:`,
    hostname: 'localhost',
    port: options.port
  }));

  let server = createServer(ssl, (req, res) => {
    req.on('data', chunk => {
      req.body = (req.body || '') + chunk;
    }).on('end', () => {
      received.push(req);
      if (handler) return handler(req, res);
      let [status = 200, body = 'test'] = (
        options.routes?.[req.url]?.(req, res) ?? []);
      if (!res.headersSent) res.writeHead(status).end(body);
    });
  });

  server.on('connection', socket => {
    connections.add(socket.on('close', () => {
      connections.delete(socket);
    }));
  });

  return {
    server,
    received,
    port: port(url),
    address: url.href,

    reply: (url, handler) => {
      (options.routes ||= {})[url] = handler;
    },

    request: (path, options) => {
      return request(new URL(path, url).href, {
        rejectUnauthorized: false,
        ...options
      });
    },

    async start() {
      return new Promise((resolve, reject) => {
        server.listen(this.port)
          .on('listening', () => resolve(this))
          .on('error', reject);
      });
    },

    async close() {
      connections.forEach(s => s.destroy());
      await new Promise(r => server.close(r));
    }
  };
}

describe('Utils Requests', () => {
  let server;

  // Adding below env variables to support self signed certs
  beforeAll(() => {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  })

  afterAll(() => {
    delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  })

  beforeEach(async () => {
    server = await createTestServer({ type: 'https', port: 8080 }).start();
  });

  afterEach(async () => {
    await server?.close();
  });

  it('returns the successful response body', async() => {
    let res = await utils.request(server.address)
    expect(res.body).toBe('test')
  })
})