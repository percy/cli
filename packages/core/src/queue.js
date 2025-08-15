import {
  yieldFor,
  generatePromise,
  AbortController
} from './utils.js';
import logger from '@percy/logger';

// Assigns a deffered promise and resolve & reject functions to an object
function deferred(obj) {
  return Object.assign(obj, {
    deferred: new Promise((resolve, reject) => {
      Object.assign(obj, { resolve, reject });
    })
  });
}

// Returns the position of a needle within a haystack, or undefined if not found
function positionOf(haystack, needle, i = 1) {
  for (let item of haystack) {
    if (item !== needle) i++;
    else return i;
  }
}

// Thrown when attempting to push to a closed queue
class QueueClosedError extends Error {
  name = this.constructor.name;
}

// A queue instance keeps a list of arbitrary items to process concurrently,
// configured and controlled by various methods
export class Queue {
  // item concurrency
  concurrency = 10;
  log = logger('core:queue');

  constructor(name) {
    this.name = name;
  }

  // Configure queue properties
  set({ concurrency }) {
    if (concurrency) this.concurrency = concurrency;
    return this;
  }

  // Configure queue handlers
  #handlers = {};

  handle(event, handler) {
    this.#handlers[event] = handler;
    return this;
  }

  // internal queues
  #queued = new Set();
  #pending = new Set();

  // Queue size is total queued and pending items
  get size() {
    return this.#queued.size + this.#pending.size;
  }

  // Pushes an item into the queue, additional args are passed to any configured task handler.
  push(item, ...args) {
    let task = deferred({ item });

    // attach any configured error handler
    task.deferred = task.deferred.catch(e => {
      if (!this.#handlers.error) throw e;
      return this.#handlers.error(item, e);
    });

    // when closed, reject with a queue closed error
    if (this.readyState > 2) {
      task.reject(new QueueClosedError());
      return task.deferred;
    }

    // call or set up other handlers
    let exists = this.cancel(item);
    task.ctrl = new AbortController();
    // duplicate abortion controller on task, so it can can be used in further
    // generators and can be cancelled internally
    // TODO fix this for non object item usecase
    if (typeof item === 'object' && !Array.isArray(item) && item !== null) {
      item._ctrl = task.ctrl;
    }
    task.item = item = this.#handlers.push
      ? this.#handlers.push(item, exists) : item;
    task.handler = () => this.#handlers.task
      ? this.#handlers.task(item, ...args) : item;

    // queue this task & maybe dequeue the next task
    this.#queued.add(task);
    this.#dequeue();

    // return the deferred task promise
    return task.deferred;
  }

  logQueueSize() {
    this.log.debug(`${this.name} queueInfo: ${JSON.stringify({
      queued: this.#queued.size,
      pending: this.#pending.size,
      total: this.#pending.size + this.#queued.size
    })}`);
  }

  // Maybe processes the next queued item task.
  #dequeue() {
    this.logQueueSize();
    if (!this.#queued.size || this.readyState < 2) return;
    if (this.#pending.size >= this.concurrency) return;
    let [task] = this.#queued;
    return this.#process(task);
  }

  // Cancels and aborts a specific item task.
  cancel(item) {
    let task = this.#find(item);
    task?.ctrl.abort();

    let queued = this.#queued.delete(task);
    let pending = this.#pending.delete(task);

    // reject queued tasks that are not pending
    if (task && queued && !pending) {
      task.reject(task.ctrl.signal.reason);
    }

    // return the cancelled item
    return task?.item;
  }

  // Returns an item task matching the provided subject.
  #find(subject) {
    let find = this.#handlers.find
    // use any configured find handler to match items
      ? ({ item }) => this.#handlers.find(subject, item)
      : ({ item }) => subject === item;

    return (
      // look at queued then pending items
      [...this.#queued].find(find) ??
      [...this.#pending].find(find)
    );
  }

  // keep track of start and end tasks
  #start = null;
  #end = null;

  // Initialize a starting task or return an existing one.
  start() {
    this.#start ??= deferred({ readyState: 1 });
    this.#start.handler ??= this.#end
    // wait for any ending task to complete first
      ? () => this.#end.promise.then(this.#handlers.start)
      : this.#handlers.start;
    return this.#process(this.#start).deferred;
  }

  // intialize an ending task or return an existing one
  end() {
    this.#end ??= deferred({ readyState: 0 });
    this.#end.handler ??= this.#start
    // wait for any starting task to complete first
      ? () => this.#start.promise.then(this.#handlers.end)
      : this.#handlers.end;
    return this.#process(this.#end).deferred;
  }

  // represents various queue states such as ready, running, or closed
  readyState = 0;

  // run the queue, starting it if necessary, and start dequeuing tasks
  run() {
    if (!this.#start) this.start();
    // when starting, state is updated afterwards
    if (this.readyState === 0) this.#start.readyState = 2;
    if (this.readyState === 1) this.readyState = 2;
    while (this.#dequeue()) this.#dequeue();
    return this;
  }

  // stop a running queue
  stop() {
    if (this.readyState === 2) this.readyState = 1;
    return this;
  }

  // close a running queue, optionally aborting it
  close(abort) {
    // when starting, state is updated afterwards
    if (this.#start?.pending) this.#start.readyState = 3;
    if (this.readyState < 3) this.readyState = 3;
    if (abort) this.clear();
    return this;
  }

  // clear and abort any queued tasks
  clear() {
    let tasks = [...this.#queued];
    this.log.debug(`Clearing ${this.name} queue, queued state: ${this.#queued.size}, pending state: ${this.#pending.size}`);
    this.#queued.clear();

    for (let task of tasks) {
      task.ctrl.abort();
      task.reject(task.ctrl.signal.reason);
    }
  }

  // process a single item task when started
  process(item) {
    let task = this.#find(item);
    if (task && !this.#start) this.start();
    this.#start?.promise.then(() => this.#process(task));
    return task?.deferred;
  }

  // processes tasks using a generator promise, allowing task handlers to be cancelable
  #process(task) {
    if (!task || task.promise) return task;

    let queued = this.#queued.has(task);
    // remove queued tasks from the queue
    if (queued) this.#queued.delete(task);
    // clear queued tasks when ending
    if (task === this.#end) this.clear();
    // add queued tasks to pending queue
    if (queued) this.#pending.add(task);
    // stop the queue when necessary
    if (task.stop) this.stop();
    // mark task as pending
    task.pending = true;

    // handle the task using a generator promise
    task.promise = generatePromise(task.handler, task.ctrl?.signal, (err, val) => {
      // clean up pending tasks that have not been aborted
      if (queued && !task.ctrl.signal.aborted) this.#pending.delete(task);
      // update queue state when necessary
      if (task.readyState != null) this.readyState = task.readyState;
      // clean up internal tasks after ending
      if (!this.readyState) this.#start = this.#end = null;
      // resolve or reject the deferred task promise
      task[err ? 'reject' : 'resolve'](err ?? val);
      // keep dequeuing when running
      if (this.readyState === 2) this.run();
      // mark pending task done
      task.pending = false;
    });

    return task;
  }

  // returns a generator that yields until started and no longer pending, calling the
  // callback every 10ms during checks with the current number of pending tasks
  idle(callback) {
    return yieldFor(() => {
      callback?.(this.#pending.size);
      let starting = this.#start?.pending === true;
      return !starting && !this.#pending.size;
    }, { idle: 10 });
  }

  // process items up to the latest queued item, starting the queue if necessary;
  // returns a generator that yields until the flushed item has finished processing
  flush(callback) {
    this.log.debug(`Flushing ${this.name} queue, queued state: ${this.#queued.size}, pending state: ${this.#pending.size}`);
    let interrupt = (
      // check for existing interrupts
      [...this.#pending].find(t => t.stop) ??
      [...this.#queued].find(t => t.stop)
    );

    // get the latest queued or pending task to track
    let flush = [...this.#queued].pop() ?? [...this.#pending].pop();
    // determine if the queue should be stopped after flushing
    if (flush) flush.stop = interrupt?.stop ?? this.readyState < 2;
    // remove the old interrupt to avoid stopping early
    if (interrupt) delete interrupt.stop;
    // start the queue if not started
    if (!this.#start) this.start();
    // run the queue if stopped
    if (flush?.stop) this.run();

    // will yield with the callback until done flushing
    return this.#until(flush, callback);
  }

  // Repeatedly yields, calling the callback with the position of the task within the queue
  async *#until(task, callback) {
    try {
      yield* yieldFor(() => {
        if (this.#start?.pending) return false;
        let queued, pending = this.#pending.size;
        // calculate the position within queued when not pending
        if (task && task.pending == null) queued = positionOf(this.#queued, task);
        // call the callback and return true when not queued or pending
        let position = (queued ?? 0) + pending;
        callback?.(position);
        return !position;
      }, { idle: 10 });
    } catch (err) {
      // reset flushed tasks on error
      if (task.stop) this.stop();
      delete task.stop;
      throw err;
    }
  }
}

export default Queue;
