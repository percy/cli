import url from 'url';
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

// Proxified https agent
export class ProxyHttpsAgent extends https.Agent {
  // enforce request options
  addRequest(request, options) {
    options.href ||= url.format({
      protocol: options.protocol,
      hostname: options.hostname,
      port: options.port,
      slashes: true
    }) + options.path;

    options.uri ||= new URL(options.href);

    let proxyUrl = (options.uri.protocol === 'https:' &&
      (process.env.https_proxy || process.env.HTTPS_PROXY)) ||
      (process.env.http_proxy || process.env.HTTP_PROXY);

    let shouldProxy = !!proxyUrl && !hostnameMatches((
      process.env.no_proxy || process.env.NO_PROXY
    ), options.href);

    if (shouldProxy) options.proxy = new URL(proxyUrl);

    // useful when testing
    options.rejectUnauthorized ??= this.rejectUnauthorized;

    return super.addRequest(request, options);
  }

  // proxy https requests using a TLS connection
  createConnection(options, callback) {
    let { uri, proxy } = options;
    let isProxyHttps = proxy?.protocol === 'https:';

    if (!proxy) {
      return super.createConnection(options, callback);
    } else if (proxy.protocol !== 'http:' && !isProxyHttps) {
      throw new Error(`Unsupported proxy protocol: ${proxy.protocol}`);
    }

    // setup socket and listeners
    let socket = (isProxyHttps ? tls : net).connect({
      ...options,
      host: proxy.hostname,
      port: proxy.port
    });

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
      options.servername = uri.hostname;
      // callback not passed in so not to be added as a listener
      callback(null, super.createConnection(options));
    };

    // write proxy connect message to the socket
    /* istanbul ignore next: port is always present for localhost tests */
    let host = `${uri.hostname}:${uri.port || 443}`;
    let connectMessage = [`CONNECT ${host} HTTP/1.1`, `Host: ${host}`];

    if (proxy.username) {
      let auth = proxy.username;
      if (proxy.password) auth += `:${proxy.password}`;

      connectMessage.push(`Proxy-Authorization: basic ${
        Buffer.from(auth).toString('base64')
      }`);
    }

    connectMessage = connectMessage.join(CRLF);
    connectMessage += CRLF.repeat(2);

    logger('client:proxy').debug(`Proxying request: ${options.href}`);

    socket
      .on('error', handleError)
      .on('close', handleClose)
      .on('data', handleData)
      .write(connectMessage);
  }
}

// Returns true or false if an error should cause the request to be retried
function shouldRetryRequest(error, retryNotFound) {
  if (error.response) {
    /* istanbul ignore next: client does not retry 404s, but other internal libs may want to */
    return (!!retryNotFound && error.response.status === 404) ||
      (error.response.status >= 500 && error.response.status < 600);
  } else if (error.code) {
    return RETRY_ERROR_CODES.includes(error.code);
  } else {
    return false;
  }
}

// Returns a promise that resolves when the request is successful and rejects
// when a non-successful response is received. The rejected error contains
// response data and any received error details. Server 500 errors are retried
// up to 5 times at 50ms intervals.
export default function request(url, { body, retries, retryNotFound, interval, ...options }) {
  /* istanbul ignore next: the client api is https only, but this helper is borrowed in some
   * cli-exec commands for its retryability with the internal api */
  let { request } = url.startsWith('https:') ? https : http;
  let { protocol, hostname, port, pathname, search } = new URL(url);
  options = { ...options, protocol, hostname, port, path: pathname + search };

  return retry((resolve, reject, retry) => {
    let handleError = error => {
      return shouldRetryRequest(error, retryNotFound)
        ? retry(error) : reject(error);
    };

    request(options)
      .on('response', res => {
        let status = res.statusCode;
        let raw = '';

        res.setEncoding('utf8')
          .on('data', chunk => (raw += chunk))
          .on('error', handleError)
          .on('end', () => {
            let body = raw;
            try { body = JSON.parse(raw); } catch (e) {}

            if (status >= 200 && status < 300) {
              resolve(body);
            } else {
              handleError(Object.assign(new Error(), {
                response: { status, body },
                // use first error detail or the status message
                message: body?.errors?.find(e => e.detail)?.detail || (
                  `${status} ${res.statusMessage || raw}`
                )
              }));
            }
          });
      })
      .on('error', handleError)
      .end(body);
  }, { retries, interval });
}
