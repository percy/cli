import crypto from 'crypto';
import { URL } from 'url';

// Returns a sha256 hash of a string.
export function sha256hash(content) {
  return crypto
    .createHash('sha256')
    .update(content, 'utf-8')
    .digest('hex');
}

// Returns a base64 encoding of a string or buffer.
export function base64encode(content) {
  return Buffer
    .from(content)
    .toString('base64');
}

// Creates a concurrent pool of promises created by the given generator.
// Resolves when the generator's final promise resolves and rejects when any
// generated promise rejects.
export function pool(generator, context, concurrency) {
  return new Promise((resolve, reject) => {
    let iterator = generator.call(context);
    let queue = 0;
    let ret = [];
    let err;

    // generates concurrent promises
    let proceed = () => {
      while (queue < concurrency) {
        let { done, value: promise } = iterator.next();

        if (done || err) {
          if (!queue && err) reject(err);
          if (!queue) resolve(ret);
          return;
        }

        queue++;
        promise.then(value => {
          queue--;
          ret.push(value);
          proceed();
        }).catch(error => {
          queue--;
          err = error;
          proceed();
        });
      }
    };

    // start generating promises
    proceed();
  });
}

// Returns a promise that resolves or rejects when the provided function calls
// `resolve` or `reject` respectively. The third function argument, `retry`,
// will recursively call the function at the specified interval until retries
// are exhausted, at which point the promise will reject with the last error
// passed to `retry`.
function retry(fn, { retries = 5, interval = 50 } = {}) {
  return new Promise((resolve, reject) => {
    // run the function, decrement retries
    let run = () => {
      fn(resolve, reject, retry);
      retries--;
    };

    // wait an interval to try again or reject with the error
    let retry = err => {
      if (retries) {
        setTimeout(run, interval);
      } else {
        reject(err);
      }
    };

    // start trying
    run();
  });
}

// Returns the appropriate http or https module for a given URL.
function httpModuleFor(url) {
  return url.match(/^https:\/\//) ? require('https') : require('http');
}

// Returns the appropriate http or https Agent instance for a given URL.
export function httpAgentFor(url) {
  let { Agent } = httpModuleFor(url);

  return new Agent({
    keepAlive: true,
    maxSockets: 5
  });
}

// Returns a promise that resolves when the request is successful and rejects
// when a non-successful response is received. The rejected error contains
// response data and any received error details. Server 500 errors are retried
// up to 5 times at 50ms intervals.
export function request(url, { body, ...options }) {
  let http = httpModuleFor(url);
  let { protocol, hostname, port, pathname, search } = new URL(url);
  options = { ...options, protocol, hostname, port, path: pathname + search };

  return retry((resolve, reject, retry) => {
    http.request(options)
      .on('response', res => {
        let status = res.statusCode;
        let raw = '';

        res.setEncoding('utf8');
        res.on('data', chunk => {
          raw += chunk;
        });

        res.on('end', () => {
          let body = raw;

          // attempt to parse json responses
          try { body = JSON.parse(raw); } catch (e) {}

          // success
          if (status >= 200 && status < 300) {
            resolve(body);
          } else {
            // error
            let err = Object.assign(new Error(), {
              response: { status, body },
              message: body?.errors?.[0]?.detail || (
                `${status} ${res.statusMessage || raw}`
              )
            });

            // retry 500s
            if (status >= 500) {
              retry(err);
            } else {
              reject(err);
            }
          }
        });
      })
      .on('error', reject)
      .end(body);
  });
}
