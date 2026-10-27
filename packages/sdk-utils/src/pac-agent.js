import net from 'net';
import tls from 'tls';
import fs from 'fs';
import http from 'http';
import https from 'https';
import crypto from 'crypto';
import { once } from 'events';
import { fileURLToPath } from 'url';
import { Agent } from 'agent-base';
import { createPacResolver } from 'pac-resolver';
import { getQuickJS } from '@tootallnate/quickjs-emscripten';

/**
 * PAC proxy agent, adapted from pac-proxy-agent@7 (MIT, Nathan Rajlich).
 *
 * NOTE: Copied from @percy/client/src/pac-agent.js for the same module
 * compatibility reasons as proxy.js. Keep the two in sync.
 *
 * pac-proxy-agent loads the PAC file through get-uri, which pulls in basic-ftp
 * for ftp:// URLs and carries its advisories into every install. This version
 * fetches the PAC file itself over http(s), file and data URLs only.
 */

const MAX_REDIRECTS = 5;
const PROTOCOLS = ['data:', 'file:', 'http:', 'https:'];

function setServernameFromNonIpHost(options) {
  if (options.servername === undefined && options.host && !net.isIP(options.host)) {
    return { ...options, servername: options.host };
  }

  return options;
}

// decodes a `data:[<mediatype>][;base64],<data>` URL
function readDataUrl(url) {
  let match = url.href.match(/^data:([^,]*?)(;base64)?,(.*)$/s);
  if (!match) throw new Error('Invalid data URL for PAC file');
  return match[2]
    ? Buffer.from(decodeURIComponent(match[3]), 'base64').toString('utf8')
    : decodeURIComponent(match[3]);
}

// GETs a PAC file, following redirects. Sends the validators from the previous
// response so an unchanged file comes back as a 304 with no body.
function requestPacFile(url, cache, redirects = 0) {
  return new Promise((resolve, reject) => {
    let { get } = url.protocol === 'https:' ? https : http;
    let headers = {};

    if (cache?.etag) headers['if-none-match'] = cache.etag;
    if (cache?.lastModified) headers['if-modified-since'] = cache.lastModified;

    get(url, { headers }, res => {
      let { statusCode, headers: resHeaders } = res;

      if (statusCode >= 300 && statusCode < 400 && statusCode !== 304 && resHeaders.location) {
        res.resume();
        if (redirects >= MAX_REDIRECTS) return reject(new Error(`Too many redirects loading PAC file: ${url.href}`));
        return resolve(requestPacFile(new URL(resHeaders.location, url), null, redirects + 1));
      }

      // only a conditional request can be answered with "not modified"
      if (statusCode === 304 && cache) {
        res.resume();
        return resolve({ notModified: true });
      }

      if (statusCode < 200 || statusCode >= 300) {
        res.resume();
        return reject(new Error(`Failed to load PAC file from ${url.href}: HTTP ${statusCode}`));
      }

      let chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('error', reject);
      res.on('end', () => resolve({
        code: Buffer.concat(chunks).toString('utf8'),
        etag: resHeaders.etag,
        lastModified: resHeaders['last-modified']
      }));
    }).on('error', reject);
  });
}

export class PacProxyAgent extends Agent {
  constructor(uri, opts) {
    super(opts);

    // strip the "pac+" prefix
    let uriStr = (typeof uri === 'string' ? uri : uri.href).replace(/^pac\+/i, '');

    // keep the URL in the message, which newer Node versions leave out
    try { this.uri = new URL(uriStr); } catch {
      throw new TypeError(`Invalid URL: ${uriStr}`);
    }

    if (!PROTOCOLS.includes(this.uri.protocol)) {
      throw new Error(`Unsupported PAC file protocol "${this.uri.protocol}", ` +
        'serve the PAC file over http(s) or from a file instead');
    }

    this.opts = { filename: this.uri.href, ...opts };
    this.cache = undefined;
    this.resolver = undefined;
    this.resolverHash = '';
    this.resolverPromise = undefined;
  }

  // Loads the PAC file if necessary, and returns a `FindProxyForURL()` resolver
  getResolver() {
    if (!this.resolverPromise) {
      let clear = () => { this.resolverPromise = undefined; };
      this.resolverPromise = this.loadResolver();
      this.resolverPromise.then(clear, clear);
    }

    return this.resolverPromise;
  }

  async loadResolver() {
    let [qjs, code] = await Promise.all([getQuickJS(), this.loadPacFile()]);
    // the file was not modified since the last load
    if (code == null) return this.resolver;

    let hash = crypto.createHash('sha1').update(code).digest('hex');
    if (this.resolver && this.resolverHash === hash) return this.resolver;

    this.resolver = createPacResolver(qjs, code, this.opts);
    this.resolverHash = hash;
    return this.resolver;
  }

  // Returns the PAC file contents, or null when an http(s) file is unchanged
  async loadPacFile() {
    let { protocol } = this.uri;

    if (protocol === 'data:') return readDataUrl(this.uri);
    if (protocol === 'file:') return fs.promises.readFile(fileURLToPath(this.uri), 'utf8');

    let res = await requestPacFile(this.uri, this.resolver && this.cache);
    if (res.notModified) return null;

    this.cache = { etag: res.etag, lastModified: res.lastModified };
    return res.code;
  }

  // Called when the node-core HTTP client library is creating a new request
  async connect(req, opts) {
    let { secureEndpoint } = opts;
    let isWebSocket = req.getHeader('upgrade') === 'websocket';
    let resolver = await this.getResolver();

    let protocol = secureEndpoint ? 'https:' : 'http:';
    let host = opts.host && net.isIPv6(opts.host) ? `[${opts.host}]` : opts.host;
    let url = new URL(req.path, `${protocol}//${host}`);

    // default to DIRECT when nothing is returned
    let result = (await resolver(url)) || 'DIRECT';
    let proxies = String(result).trim().split(/\s*;\s*/g).filter(Boolean);

    if (this.opts.fallbackToDirect && !proxies.includes('DIRECT')) {
      proxies.push('DIRECT');
    }

    for (let proxy of proxies) {
      let agent = null;
      let socket = null;
      let [type, target] = proxy.split(/\s+/);

      if (type === 'DIRECT') {
        socket = secureEndpoint
          ? tls.connect(setServernameFromNonIpHost(opts))
          : net.connect(opts);
      } else if (type === 'SOCKS' || type === 'SOCKS5' || type === 'SOCKS4') {
        let { SocksProxyAgent } = await import('socks-proxy-agent');
        agent = new SocksProxyAgent(`${type === 'SOCKS4' ? 'socks4a' : 'socks'}://${target}`, this.opts);
      } else if (type === 'PROXY' || type === 'HTTP' || type === 'HTTPS') {
        let proxyURL = `${type === 'HTTPS' ? 'https' : 'http'}://${target}`;

        if (secureEndpoint || isWebSocket) {
          let { HttpsProxyAgent } = await import('https-proxy-agent');
          agent = new HttpsProxyAgent(proxyURL, this.opts);
        } else {
          let { HttpProxyAgent } = await import('http-proxy-agent');
          agent = new HttpProxyAgent(proxyURL, this.opts);
        }
      }

      try {
        if (socket) {
          await once(socket, 'connect');
          req.emit('proxy', { proxy, socket });
          return socket;
        }

        if (agent) {
          let s = await agent.connect(req, opts);
          if (!(s instanceof net.Socket)) throw new Error('Expected a `net.Socket` to be returned from agent');
          req.emit('proxy', { proxy, socket: s });
          return s;
        }

        throw new Error(`Could not determine proxy type for: ${proxy}`);
      } catch (error) {
        req.emit('proxy', { proxy, error });
      }
    }

    throw new Error(`Failed to establish a socket connection to proxies: ${JSON.stringify(proxies)}`);
  }
}

export default PacProxyAgent;
