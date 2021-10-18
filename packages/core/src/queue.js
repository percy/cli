import { waitFor } from './utils';

function isGenerator(obj) {
  return typeof obj.next === 'function' && (
    typeof obj[Symbol.iterator] === 'function' ||
    typeof obj[Symbol.asyncIterator] === 'function'
  );
}

async function runGeneratorTask(task, arg) {
  if (task.canceled) await task.generator.throw(new Error('Canceled'));
  let { done, value } = await task.generator.next(arg);
  return done ? value : runGeneratorTask(task, value);
}

export default class Queue {
  running = true;
  closed = false;

  #queued = new Map();
  #pending = new Map();

  constructor(concurrency = 10) {
    this.concurrency = concurrency;
  }

  push(id, callback, priority) {
    if (this.closed) throw new Error('Closed');
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
    let pending = this.#pending.get(id);
    if (pending) pending.canceled = true;
    this.#pending.delete(id);
    this.#queued.delete(id);
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

  close(abort) {
    if (abort) this.stop().clear();
    this.closed = true;
    return this;
  }

  async idle() {
    await waitFor(() => {
      return !this.#pending.size;
    }, { idle: 10 });
  }

  async empty(onCheck) {
    await waitFor(() => {
      onCheck?.(this.size);
      return !this.size;
    }, { idle: 10 });
  }

  async flush() {
    this.push('@@/flush', () => this.stop());
    await this.run().idle();
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

    let done = (callback, arg) => {
      this.#pending.delete(task.id);
      callback(arg);
      this._dequeue();
    };

    try {
      let result = task.callback();

      if (isGenerator(result)) {
        task.generator = result;
        result = runGeneratorTask(task);
      }

      return Promise.resolve(result)
        .then(done.bind(null, task.resolve))
        .catch(done.bind(null, task.reject));
    } catch (err) {
      done(task.reject, err);
    }
  }
}
