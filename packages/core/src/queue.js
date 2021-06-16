import { waitFor } from './utils';

export default class Queue {
  running = true;
  closed = false;

  #queued = new Map();
  #pending = new Map();

  constructor(concurrency = 5) {
    this.concurrency = concurrency;
  }

  push(id, callback, priority) {
    if (this.closed) throw new Error('Closed');

    let task = { id, callback, priority };

    task.promise = new Promise((resolve, reject) => {
      Object.assign(task, { resolve, reject });
      this.#queued.delete(id);
      this.#queued.set(id, task);
      this._dequeue();
    });

    return task.promise;
  }

  clear(id) {
    if (id != null) {
      this.#queued.delete(id);
    } else {
      this.#queued.clear();
    }

    return this.length;
  }

  get length() {
    return this.#queued.size +
      this.#pending.size;
  }

  run() {
    if (!this.running && !this.closed) {
      this.running = true;

      while (this.running && this.#queued.size && (
        this.#pending.size < this.concurrency
      )) this._dequeue();
    }

    return this;
  }

  pause() {
    this.running = false;
    return this;
  }

  close() {
    this.closed = true;
    return this;
  }

  async idle() {
    await waitFor(() => !this.#pending.size, { idle: 10 });
  }

  async empty() {
    await waitFor(() => !this.length, { idle: 10 });
  }

  async flush() {
    this.push('@@/flush', () => this.pause());
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

    return Promise.resolve(
      task.callback()
    ).then(res => {
      this.#pending.delete(task.id);
      return task.resolve(res);
    }).catch(err => {
      this.#pending.delete(task.id);
      return task.reject(err);
    }).then(() => {
      this._dequeue();
    });
  }
}
