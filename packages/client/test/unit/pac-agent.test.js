import fs from 'fs';
import os from 'os';
import net from 'net';
import path from 'path';
import http from 'http';
import https from 'https';
import tls from 'tls';
import { fileURLToPath, pathToFileURL } from 'url';
import { HttpProxyAgent } from 'http-proxy-agent';
import { PacProxyAgent } from '../../src/pac-agent.js';

const certs = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../certs');
const ssl = { key: fs.readFileSync(path.join(certs, 'test.key')), cert: fs.readFileSync(path.join(certs, 'test.crt')) };

// escapes characters that could end the string literal or script early
const toLiteral = str => JSON.stringify(str)
  .replace(/[<>/\u2028\u2029]/g, c => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
// a PAC file that always returns the given result
const pacFile = result => `function FindProxyForURL(url, host) { return ${toLiteral(result)}; }`;
const dataUrl = result => `data:application/x-ns-proxy-autoconfig,${encodeURIComponent(pacFile(result))}`;

// starts a server on a random port and tracks its sockets so it can be closed
async function listen(server) {
  let sockets = new Set();
  server.on('connection', s => sockets.add(s.on('close', () => sockets.delete(s))));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));

  return {
    server,
    port: server.address().port,
    close: () => new Promise(resolve => {
      sockets.forEach(s => s.destroy());
      server.close(resolve);
    })
  };
}

// an HTTP proxy that answers absolute-form requests itself and tunnels CONNECT requests
function createProxy() {
  let received = [];

  let server = http.createServer((req, res) => {
    received.push(`${req.method} ${req.url}`);
    res.end('proxied');
  });

  server.on('connect', (req, socket) => {
    received.push(`CONNECT ${req.url}`);
    let [host, port] = req.url.split(':');

    socket.on('error', () => upstream.destroy());
    let upstream = net.connect(port, host, () => {
      socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      upstream.pipe(socket).pipe(upstream);
    }).on('error', () => socket.destroy());
  });

  return { server, received };
}

function get(url, agent, options = {}) {
  let { get } = url.startsWith('https:') ? https : http;
  let proxies = [];

  return new Promise((resolve, reject) => {
    let req = get(url, { agent, ca: ssl.cert, ...options }, res => {
      let body = '';
      res.on('data', d => (body += d));
      res.on('end', () => resolve({ status: res.statusCode, body, proxies }));
    });

    req.on('proxy', p => proxies.push(p));
    req.on('upgrade', (res, socket) => {
      socket.destroy();
      resolve({ status: res.statusCode, proxies });
    });
    req.on('error', reject);
  });
}

describe('Unit / PacProxyAgent', () => {
  let target, secureTarget, proxy, pacServer, tmp;

  beforeEach(async () => {
    target = await listen(http.createServer((req, res) => res.end('target')));
    // the client closes the upgraded socket; ending it here races that on Node 14
    target.server.on('upgrade', (req, socket) => socket.on('error', () => {}).write(
      'HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n'));
    secureTarget = await listen(https.createServer(ssl, (req, res) => res.end('secure target')));
    proxy = createProxy();
    proxy = { ...proxy, ...await listen(proxy.server) };
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'percy-pac-'));
  });

  afterEach(async () => {
    await target.close();
    await secureTarget.close();
    await proxy.close();
    await pacServer?.close();
    pacServer = null;
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  // serves PAC files from the routes object, keyed by request path
  async function servePac(routes) {
    let handlers = Object.entries(routes);

    pacServer = await listen(http.createServer((req, res) => {
      let [, handler] = handlers.find(([path]) => path === req.url) || [];
      if (!handler) return res.writeHead(404).end();
      let [status, headers, body] = handler(req);
      res.writeHead(status, headers).end(body);
    }));

    return `http://127.0.0.1:${pacServer.port}`;
  }

  describe('constructor', () => {
    it('strips the pac+ prefix and accepts URL objects', () => {
      expect(new PacProxyAgent('pac+http://example.com/proxy.pac').uri.href)
        .toEqual('http://example.com/proxy.pac');
      expect(new PacProxyAgent(new URL('file:///tmp/proxy.pac')).uri.href)
        .toEqual('file:///tmp/proxy.pac');
    });

    it('names the URL when it is invalid', () => {
      expect(() => new PacProxyAgent('pac+not a url')).toThrowError(TypeError, 'Invalid URL: not a url');
    });

    it('rejects PAC files served over ftp and other protocols', () => {
      expect(() => new PacProxyAgent('ftp://example.com/proxy.pac'))
        .toThrowError('Unsupported PAC file protocol "ftp:", serve the PAC file over http(s) or from a file instead');
      expect(() => new PacProxyAgent('pac+ftp://example.com/proxy.pac')).toThrowError(/ftp:/);
    });
  });

  describe('loading the PAC file', () => {
    it('reads plain and base64 data URLs', async () => {
      let plain = await new PacProxyAgent(dataUrl('DIRECT')).getResolver();
      expect(await plain('http://example.com/')).toEqual('DIRECT');

      let b64 = Buffer.from(pacFile('PROXY a:1')).toString('base64');
      let base64 = await new PacProxyAgent(`data:;base64,${b64}`).getResolver();
      expect(await base64('http://example.com/')).toEqual('PROXY a:1');
    });

    it('keeps a % that does not start an escape in data URLs', async () => {
      let code = 'function FindProxyForURL(url, host) { return host.length % 2 ? "PROXY e:5" : "DIRECT"; }';
      let resolver = await new PacProxyAgent(`data:,${code}`).getResolver();
      expect(await resolver('http://abc/')).toEqual('PROXY e:5');
      expect(await resolver('http://ab/')).toEqual('DIRECT');
    });

    it('rejects a malformed data URL', async () => {
      await expectAsync(new PacProxyAgent('data:no-comma').getResolver())
        .toBeRejectedWithError('Invalid data URL for PAC file');
    });

    it('reads file URLs', async () => {
      let file = path.join(tmp, 'proxy.pac');
      fs.writeFileSync(file, pacFile('PROXY b:2'));

      let resolver = await new PacProxyAgent(pathToFileURL(file).href).getResolver();
      expect(await resolver('http://example.com/')).toEqual('PROXY b:2');
    });

    it('loads the file once for concurrent requests', async () => {
      let agent = new PacProxyAgent(dataUrl('DIRECT'));
      spyOn(agent, 'loadResolver').and.callThrough();

      let [a, b] = await Promise.all([agent.getResolver(), agent.getResolver()]);
      expect(a).toBe(b);
      expect(agent.loadResolver).toHaveBeenCalledTimes(1);
    });

    it('follows redirects over http', async () => {
      let base = await servePac({
        '/old.pac': () => [302, { location: '/proxy.pac' }],
        '/proxy.pac': () => [200, {}, pacFile('PROXY c:3')]
      });

      let resolver = await new PacProxyAgent(`${base}/old.pac`).getResolver();
      expect(await resolver('http://example.com/')).toEqual('PROXY c:3');
    });

    it('stops after too many redirects', async () => {
      let base = await servePac({ '/loop.pac': () => [302, { location: '/loop.pac' }] });

      await expectAsync(new PacProxyAgent(`${base}/loop.pac`).getResolver())
        .toBeRejectedWithError(/^Too many redirects loading PAC file/);
    });

    it('refuses to leave https or http when redirected', async () => {
      let base = await servePac({
        '/old.pac': () => [302, { location: 'http://127.0.0.1:1/proxy.pac' }],
        '/file.pac': () => [302, { location: 'file:///etc/passwd' }]
      });
      // serve the https URL from the plain http server so no certificate is needed
      spyOn(https, 'get').and.callFake((url, opts, cb) => http.get(`${base}${url.pathname}`, opts, cb));

      await expectAsync(new PacProxyAgent('https://pac.test/old.pac').getResolver())
        .toBeRejectedWithError('Refusing to follow a redirect from https://pac.test/old.pac ' +
          'to http://127.0.0.1:1/proxy.pac loading PAC file');
      await expectAsync(new PacProxyAgent(`${base}/file.pac`).getResolver())
        .toBeRejectedWithError(/^Refusing to follow a redirect .* to file:\/\/\/etc\/passwd/);
    });

    it('gives up on a PAC server that never answers', async () => {
      pacServer = await listen(http.createServer(() => {}));
      let url = `http://127.0.0.1:${pacServer.port}/proxy.pac`;

      await expectAsync(new PacProxyAgent(url, { pacTimeout: 50 }).getResolver())
        .toBeRejectedWithError(`Timed out after 50ms loading PAC file from ${url}`);
    });

    it('rejects non-2xx responses', async () => {
      let base = await servePac({
        '/missing.pac': () => [404, {}, 'nope'],
        '/unconditional.pac': () => [304, {}]
      });

      await expectAsync(new PacProxyAgent(`${base}/missing.pac`).getResolver())
        .toBeRejectedWithError(`Failed to load PAC file from ${base}/missing.pac: HTTP 404`);
      // a 304 to a request that sent no validators is a server error
      await expectAsync(new PacProxyAgent(`${base}/unconditional.pac`).getResolver())
        .toBeRejectedWithError(/HTTP 304$/);
    });

    it('rejects when the PAC server cannot be reached', async () => {
      await expectAsync(new PacProxyAgent('https://127.0.0.1:1/proxy.pac').getResolver())
        .toBeRejectedWithError(/ECONNREFUSED/);
    });

    it('revalidates with the last validators and reuses the resolver when unchanged', async () => {
      let requests = [];
      let base = await servePac({
        '/proxy.pac': req => {
          requests.push(req.headers);
          if (req.headers['if-none-match'] === '"v1"') return [304, {}];
          return [200, { etag: '"v1"', 'last-modified': 'Mon, 26 Oct 2026 00:00:00 GMT' }, pacFile('DIRECT')];
        }
      });

      let agent = new PacProxyAgent(`${base}/proxy.pac`);
      let first = await agent.getResolver();
      let second = await agent.getResolver();

      expect(second).toBe(first);
      expect(requests[0]['if-none-match']).toBeUndefined();
      expect(requests[1]).toEqual(jasmine.objectContaining({
        'if-none-match': '"v1"',
        'if-modified-since': 'Mon, 26 Oct 2026 00:00:00 GMT'
      }));
    });

    it('reuses the resolver for identical contents and rebuilds it when they change', async () => {
      let result = 'DIRECT';
      let base = await servePac({ '/proxy.pac': () => [200, {}, pacFile(result)] });
      let agent = new PacProxyAgent(`${base}/proxy.pac`);

      let first = await agent.getResolver();
      expect(await agent.getResolver()).toBe(first);

      result = 'PROXY d:4';
      let changed = await agent.getResolver();
      expect(changed).not.toBe(first);
      expect(await changed('http://example.com/')).toEqual('PROXY d:4');
    });
  });

  describe('connecting', () => {
    it('connects directly for DIRECT and empty results', async () => {
      let res = await get(`http://127.0.0.1:${target.port}/`, new PacProxyAgent(dataUrl('DIRECT')));
      expect(res.body).toEqual('target');
      expect(res.proxies.map(p => p.proxy)).toEqual(['DIRECT']);

      res = await get(`http://127.0.0.1:${target.port}/`, new PacProxyAgent(dataUrl('')));
      expect(res.body).toEqual('target');
      expect(proxy.received).toEqual([]);
    });

    it('connects directly over TLS', async () => {
      let res = await get(`https://localhost:${secureTarget.port}/`, new PacProxyAgent(dataUrl('DIRECT')));
      expect(res.body).toEqual('secure target');
    });

    it('sets the TLS servername for hostnames but not IP addresses', async () => {
      spyOn(tls, 'connect').and.callThrough();
      let agent = new PacProxyAgent(dataUrl('DIRECT'));
      let req = { path: '/', getHeader: () => undefined, emit: () => {} };
      let opts = { port: secureTarget.port, secureEndpoint: true, ca: ssl.cert };

      (await agent.connect(req, { ...opts, host: 'localhost' })).destroy();
      (await agent.connect(req, { ...opts, host: '127.0.0.1' })).destroy();

      expect(tls.connect.calls.argsFor(0)[0].servername).toEqual('localhost');
      expect(tls.connect.calls.argsFor(1)[0].servername).toBeUndefined();
    });

    it('sends http requests through a PROXY', async () => {
      let res = await get(`http://127.0.0.1:${target.port}/page`,
        new PacProxyAgent(dataUrl(`PROXY 127.0.0.1:${proxy.port}`)));

      expect(res.body).toEqual('proxied');
      expect(proxy.received).toEqual([`GET http://127.0.0.1:${target.port}/page`]);
    });

    it('tunnels https and websocket requests through a PROXY', async () => {
      let agent = new PacProxyAgent(dataUrl(`PROXY 127.0.0.1:${proxy.port}`));

      let res = await get(`https://localhost:${secureTarget.port}/`, agent);
      expect(res.body).toEqual('secure target');

      res = await get(`http://127.0.0.1:${target.port}/ws`, agent, {
        headers: { upgrade: 'websocket', connection: 'Upgrade' }
      });
      expect(res.status).toEqual(101);

      expect(proxy.received).toEqual([
        `CONNECT localhost:${secureTarget.port}`,
        `CONNECT 127.0.0.1:${target.port}`
      ]);
    });

    it('tries each proxy in order and reports failures', async () => {
      let res = await get(`http://127.0.0.1:${target.port}/`, new PacProxyAgent(dataUrl(
        'SOCKS4 127.0.0.1:1; SOCKS 127.0.0.1:1; HTTPS 127.0.0.1:1; HTTP 127.0.0.1:1; BOGUS x; DIRECT')));

      expect(res.body).toEqual('target');
      expect(res.proxies.map(p => p.proxy)).toEqual([
        'SOCKS4 127.0.0.1:1', 'SOCKS 127.0.0.1:1', 'HTTPS 127.0.0.1:1',
        'HTTP 127.0.0.1:1', 'BOGUS x', 'DIRECT'
      ]);
      expect(res.proxies[4].error.message).toEqual('Could not determine proxy type for: BOGUS x');
      expect(res.proxies.slice(0, 4).every(p => p.error)).toBe(true);
    });

    it('falls back to a direct connection when asked to', async () => {
      let res = await get(`http://127.0.0.1:${target.port}/`, new PacProxyAgent(
        dataUrl('PROXY 127.0.0.1:1'), { fallbackToDirect: true }));

      expect(res.body).toEqual('target');
      expect(res.proxies.map(p => p.proxy)).toEqual(['PROXY 127.0.0.1:1', 'DIRECT']);
    });

    it('fails when no proxy can connect', async () => {
      await expectAsync(get(`http://127.0.0.1:${target.port}/`, new PacProxyAgent(dataUrl('PROXY 127.0.0.1:1'))))
        .toBeRejectedWithError('Failed to establish a socket connection to proxies: ["PROXY 127.0.0.1:1"]');
    });

    it('rejects a proxy agent that does not return a socket', async () => {
      spyOn(HttpProxyAgent.prototype, 'connect').and.resolveTo({});

      await expectAsync(get(`http://127.0.0.1:${target.port}/`, new PacProxyAgent(dataUrl(`PROXY 127.0.0.1:${proxy.port}`))))
        .toBeRejectedWithError(/Failed to establish a socket connection/);
    });

    it('brackets IPv6 hosts when building the resolved URL', async () => {
      let agent = new PacProxyAgent(dataUrl('BOGUS x'));
      let resolver = await agent.getResolver();
      let resolved = jasmine.createSpy('resolver').and.callFake(resolver);
      agent.resolver = resolved;
      spyOn(agent, 'getResolver').and.resolveTo(resolved);

      let req = { path: '/a', getHeader: () => undefined, emit: () => {} };
      await expectAsync(agent.connect(req, { host: '::1', port: 80 })).toBeRejected();
      expect(String(resolved.calls.argsFor(0)[0])).toEqual('http://[::1]/a');
    });
  });
});
