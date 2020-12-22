import waitFor from './utils/wait-for';

// Concurrent task-based queue for handling snapshots and asset discovery.
export default class Queue {
  #queue = []
  #pending = 0

  // Defaults to inifinite concurrency
  constructor(concurrency = Infinity) {
    this.concurrency = concurrency;
  }

  // Pushing a new task to the queue will attempt to run it unless the
  // concurrency limit has been reached. The returned promise will resolve or
  // reject when the task has succeeded or thrown an error.
  push(task) {
    return new Promise((resolve, reject) => {
      this.#queue.push({ task, resolve, reject });
      this._dequeue();
    });
  }

  // Returns the amount of queued and pending tasks.
  get length() {
    return this.#queue.length + this.#pending;
  }

  // Resolves when there are no more queued or pending tasks.
  idle() {
    return waitFor(() => this.length === 0, {
      timeout: 2 * 60 * 1000 // 2 minutes
    });
  }

  // Clears the active queue. Tasks that were queued will not be executed and
  // tasks that are pending (have already executed) will be allowed to finish.
  clear() {
    this.#queue = [];
    return this.length;
  }

  // Begins processing the queue by running the oldest task first. Pending tasks
  // are tracked and no tasks will run unless there are less pending than the
  // concurrency limit. More tasks are dequeued when the current task
  // finishes. Resolves when the current task finishes although this method
  // should never be awaited on so multiple tasks can run concurrently.
  async _dequeue() {
    if (this.#pending >= this.concurrency) return;
    let item = this.#queue.shift();
    if (!item) return;
    this.#pending++;

    try {
      let value = await item.task();
      this.#pending--;
      item.resolve(value);
    } catch (error) {
      this.#pending--;
      item.reject(error);
    } finally {
      this._dequeue();
    }
  }
}
