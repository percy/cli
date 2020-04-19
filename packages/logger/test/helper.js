import stripAnsi from 'strip-ansi';

const og = {
  out: process.stdout.write,
  err: process.stderr.write
};

function format(chunk, { ansi = false } = {}) {
  // strip ansi and normalize line endings
  return (ansi ? chunk : stripAnsi(chunk)).replace('\r\n', '\n');
}

function tryFinally(fn, cb) {
  let done = (r, e) => {
    if ((cb(), e)) throw e;
    return r;
  };

  let r, e;
  try { r = fn(); } catch (err) { e = err; }

  if (typeof r?.then === 'function') {
    return r.then(done, e => done(null, e));
  } else {
    return done(r, e);
  }
}

const stdio = {
  1: [],
  2: [],

  capture(fn, options) {
    stdio.flush();
    process.stdout.write = chunk => stdio[1].push(format(chunk, options));
    process.stderr.write = chunk => stdio[2].push(format(chunk, options));
    return fn ? tryFinally(fn, stdio.restore) : null;
  },

  restore() {
    process.stdout.write = og.out;
    process.stderr.write = og.err;
  },

  flush() {
    let output = [null, stdio[1], stdio[2]];
    stdio[1] = []; stdio[2] = [];
    return output;
  }
};

export default stdio;
