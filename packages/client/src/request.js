import net from 'net';
import tls from 'tls';
import http from 'http';
import https from 'https';
import logger from '@percy/logger';
import { retry, hostnameMatches } from './utils';

const CRLF = '\r\n';
const STATUS_REG = /^HTTP\/1.[01] (\d*)/;
const RETRY_ERROR_CODES = [
  'ECONNREFUSED', 'ECONNRESET', 'EPIPE',
  'EHOSTUNREACH', 'EAI_AGAIN'
];

// Returns the port number of a URL object. Defaults to port 443 for https
// protocols or port 80 otherwise.
export function port(options) {
  if (options.port) return options.port;
  return options.protocol === 'https:' ? 443 : 80;
}

export function href(options) {
  let { protocol, hostname, path, pathname, search, hash } = options;
  return `${protocol}//${hostname}:${port(options)}` +
    (path || `${pathname || ''}${search || ''}${hash || ''}`);
};

export function getProxy(options) {
  let proxyUrl = (options.protocol === 'https:' &&
    (process.env.https_proxy || process.env.HTTPS_PROXY)) ||
    (process.env.http_proxy || process.env.HTTP_PROXY);

  let shouldProxy = !!proxyUrl && !hostnameMatches((
    process.env.no_proxy || process.env.NO_PROXY
  ), href(options));

  if (shouldProxy) {
    proxyUrl = new URL(proxyUrl);
    let isHttps = proxyUrl.protocol === 'https:';

    if (!isHttps && proxyUrl.protocol !== 'http:') {
      throw new Error(`Unsupported proxy protocol: ${proxyUrl.protocol}`);
    }

    let proxy = { isHttps };
    proxy.auth = !!proxyUrl.username && 'Basic ' + (proxyUrl.password
      ? Buffer.from(`${proxyUrl.username}:${proxyUrl.password}`)
      : Buffer.from(proxyUrl.username)).toString('base64');
    proxy.host = proxyUrl.hostname;
    proxy.port = port(proxyUrl);

    proxy.connect = () => (isHttps ? tls : net).connect({
      rejectUnauthorized: options.rejectUnauthorized,
      host: proxy.host,
      port: proxy.port
    });

    return proxy;
  }
}

// Proxified http agent
export class ProxyHttpAgent extends http.Agent {
  // needed for https proxies
  httpsAgent = new https.Agent({ keepAlive: true });

  addRequest(request, options) {
    let proxy = getProxy(options);
    if (!proxy) return super.addRequest(request, options);
    logger('client:proxy').debug(`Proxying request: ${options.href}`);

    // modify the request for proxying
    request.path = href(options);

    if (proxy.auth) {
      request.setHeader('Proxy-Authorization', proxy.auth);
    }

    // regenerate headers since we just changed things
    delete request._header;
    request._implicitHeader();

    if (request.outputData?.length > 0) {
      let first = request.outputData[0].data;
      let endOfHeaders = first.indexOf(CRLF.repeat(2)) + 4;
      request.outputData[0].data = request._header +
        first.substring(endOfHeaders);
    }

    // coerce the connection to the proxy
    options.port = proxy.port;
    options.host = proxy.host;
    delete options.path;

    if (proxy.isHttps) {
      // use the underlying https agent to complete the connection
      request.agent = this.httpsAgent;
      return this.httpsAgent.addRequest(request, options);
    } else {
      return super.addRequest(request, options);
    }
  }
}

// Proxified https agent
export class ProxyHttpsAgent extends https.Agent {
  constructor(options) {
    // default keep-alive
    super({ keepAlive: true, ...options });
  }

  createConnection(options, callback) {
    let proxy = getProxy(options);
    if (!proxy) return super.createConnection(options, callback);
    logger('client:proxy').debug(`Proxying request: ${href(options)}`);

    // generate proxy connect message
    let host = `${options.hostname}:${port(options)}`;
    let connectMessage = [`CONNECT ${host} HTTP/1.1`, `Host: ${host}`];

    if (proxy.auth) {
      connectMessage.push(`Proxy-Authorization: ${proxy.auth}`);
    }

    connectMessage = connectMessage.join(CRLF);
    connectMessage += CRLF.repeat(2);

    // start the proxy connection and setup listeners
    let socket = proxy.connect();

    let handleError = err => {
      socket.destroy(err);
      callback(err);
    };

    let handleClose = () => handleError(
      new Error('Connection closed while sending request to upstream proxy')
    );

    let buffer = '';
    let handleData = data => {
      buffer += data.toString();
      // haven't received end of headers yet, keep buffering
      if (!buffer.includes(CRLF.repeat(2))) return;
      // stop listening after end of headers
      socket.off('data', handleData);

      if (buffer.match(STATUS_REG)?.[1] !== '200') {
        return handleError(new Error(
          'Error establishing proxy connection. ' +
            `Response from server was: ${buffer}`
        ));
      }

      options.socket = socket;
      options.servername = options.hostname;
      // callback not passed in so not to be added as a listener
      callback(null, super.createConnection(options));
    };

    // send and handle the connect message
    socket
      .on('error', handleError)
      .on('close', handleClose)
      .on('data', handleData)
      .write(connectMessage);
  }
}

export function proxyAgentFor(url, options) {
  let cache = (proxyAgentFor.cache ||= new Map());
  let { protocol, hostname } = new URL(url);
  let cachekey = `${protocol}//${hostname}`;

  if (!cache.has(cachekey)) {
    cache.set(cachekey, protocol === 'https:'
      ? new ProxyHttpsAgent(options)
      : new ProxyHttpAgent(options));
  }

  return cache.get(cachekey);
}

// Proxified request function that resolves with the response body when the request is successful
// and rejects when a non-successful response is received. The rejected error contains response data
// and any received error details. Server 500 errors are retried up to 5 times at 50ms intervals by
// default, and 404 errors may also be optionally retried. If a callback is provided, it is called
// with the parsed response body and response details. If the callback returns a value, that value
// will be returned in the final resolved promise instead of the response body.
export function request(url, options = {}, callback) {
  // accept `request(url, callback)`
  if (typeof options === 'function') [options, callback] = [{}, options];
  let { body, retries, retryNotFound, interval, noProxy, ...requestOptions } = options;
  // allow bypassing proxied requests entirely
  if (!noProxy) requestOptions.agent ||= proxyAgentFor(url);
  // parse the requested URL into request options
  let { protocol, hostname, port, pathname, search, hash } = new URL(url);

  return retry((resolve, reject, retry) => {
    let handleError = error => {
      if (handleError.handled) return;
      handleError.handled = true;

      let shouldRetry = error.response
      // maybe retry 404s and always retry 500s
        ? ((retryNotFound && error.response.status === 404) ||
           (error.response.status >= 500 && error.response.status < 600))
      // retry specific error codes
        : (!!error.code && RETRY_ERROR_CODES.includes(error.code));

      return shouldRetry ? retry(error) : reject(error);
    };

    let handleFinished = async (body, res) => {
      let raw = body;

      // attempt to parse the body as json
      try { body = JSON.parse(body); } catch (e) {}

      try {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          // resolve successful statuses after the callback
          resolve(await callback?.(body, res) ?? body);
        } else {
          // use the first error detail or the status message
          throw new Error(body?.errors?.find(e => e.detail)?.detail || (
            `${res.statusCode} ${res.statusMessage || raw}`
          ));
        }
      } catch (error) {
        handleError(Object.assign(error, {
          response: { status: res.statusCode, body }
        }));
      }
    };

    let handleResponse = res => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', chunk => (body += chunk));
      res.on('end', () => handleFinished(body, res));
      res.on('error', handleError);
    };

    let req = (protocol === 'https:' ? https : http).request({
      ...requestOptions,
      path: pathname + search + hash,
      protocol,
      hostname,
      port
    });

    req.on('response', handleResponse);
    req.on('error', handleError);
    req.end(body);
  }, { retries, interval });
}

export default request;
