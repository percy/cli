import crypto from 'crypto';

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
export function retry(fn, { retries = 5, interval = 50 }) {
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

// Returns true if the URL hostname matches any patterns
export function hostnameMatches(patterns, url) {
  let subject = new URL(url);

  /* istanbul ignore next: only strings are provided internally by the client proxy; core (which
   * borrows this util) sometimes provides an array of patterns or undefined */
  patterns = typeof patterns === 'string'
    ? patterns.split(/[\s,]+/)
    : [].concat(patterns);

  for (let pattern of patterns) {
    if (pattern === '*') return true;
    if (!pattern) continue;

    // parse pattern
    let { groups: rule } = pattern.match(
      /^(?<hostname>.+?)(?::(?<port>\d+))?$/
    );

    // missing a hostname or ports do not match
    if (!rule.hostname || (rule.port && rule.port !== subject.port)) {
      continue;
    }

    // wildcards are treated the same as leading dots
    rule.hostname = rule.hostname.replace(/^\*/, '');

    // hostnames are equal or end with a wildcard rule
    if (rule.hostname === subject.hostname ||
        (rule.hostname.startsWith('.') &&
         subject.hostname.endsWith(rule.hostname))) {
      return true;
    }
  }

  return false;
}
