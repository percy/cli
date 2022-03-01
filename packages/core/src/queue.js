import {
  generatePromise,
  waitFor
} from './utils';

export class Queue {
  running = true;
  closed = false;

  #queued = new Map();
  #pending = new Map();

  constructor(concurrency = 10) {
    this.concurrency = concurrency;
  }

  push(id, callback, priority) {
    /* istanbul ignore next: race condition paranoia */
    if (this.closed && !id.startsWith('@@/')) return;

    this.cancel(id);

    let task = { id, callback, priority };
    task.promise = new Promise((resolve, reject) => {
      Object.assign(task, { resolve, reject });
      this.#queued.set(id, task);
      this._dequeue();
    });

    return task.promise;
  }

  cancel(id) {
    this.#pending.get(id)?.cancel?.();
    this.#pending.delete(id);
    this.#queued.delete(id);
  }

  has(id) {
    return this.#queued.has(id) ||
      this.#pending.has(id);
  }

  clear() {
    this.#queued.clear();
    return this.size;
  }

  get size() {
    return this.#queued.size + this.#pending.size;
  }

  run() {
    this.running = true;

    while (this.running && this.#queued.size && (
      this.#pending.size < this.concurrency
    )) this._dequeue();

    return this;
  }

  stop() {
    this.running = false;
    return this;
  }

  open() {
    this.closed = false;
    return this;
  }

  close(abort) {
    if (abort) this.stop().clear();
    this.closed = true;
    return this;
  }

  idle(callback) {
    return waitFor(() => {
      callback?.(this.#pending.size);
      return !this.#pending.size;
    }, { idle: 10 });
  }

  empty(callback) {
    return waitFor(() => {
      callback?.(this.size);
      return !this.size;
    }, { idle: 10 });
  }

  flush(callback) {
    let stopped = !this.running;

    this.run().push('@@/flush', () => {
      if (stopped) this.stop();
    });

    return this.idle(pend => {
      let left = [...this.#queued.keys()].indexOf('@@/flush');
      if (!~left && !this.#pending.has('@@/flush')) left = 0;
      callback?.(pend + left);
    }).canceled(() => {
      if (stopped) this.stop();
      this.cancel('@@/flush');
    });
  }

  next() {
    let next;

    for (let [id, task] of this.#queued) {
      if (!next || (task.priority != null && next.priority == null) ||
          task.priority < next.priority) next = task;
      if (id === '@@/flush') break;
    }

    return next;
  }

  _dequeue() {
    if (!this.running) return;
    if (this.#pending.size >= this.concurrency) return;
    let task = this.next();
    if (!task) return;

    this.#queued.delete(task.id);
    this.#pending.set(task.id, task);

    let done = callback => arg => {
      if (!task.cancel?.triggered) {
        this.#pending.delete(task.id);
      }

      callback(arg);
      this._dequeue();
    };

    try {
      let gen = generatePromise(task.callback);
      task.cancel = gen.cancel;

      return gen.then(done(task.resolve), done(task.reject));
    } catch (err) {
      done(task.reject)(err);
    }
  }
}

export default Queue;
