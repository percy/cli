import { AbortController, generatePromise, waitForTimeout } from '../../src/utils.js';
import Queue from '../../src/queue.js';

describe('Unit / Tasks Queue', () => {
  let q;

  beforeEach(() => {
    q = new Queue();
  });

  it('has a customizable concurrency', () => {
    expect(q.concurrency).toBe(10);
    q.set({ concurrency: 2 });
    expect(q.concurrency).toBe(2);
  });

  it('can push items to the queue', () => {
    expect(q.size).toBe(0);
    q.push(1);
    q.push('item #2');
    expect(q.size).toBe(2);
    q.push({ value: 'item #3' });
    expect(q.size).toBe(3);
  });

  it('can cancel existing queued items', async () => {
    let p1 = q.push('item #1');
    let p2 = q.push('item #2');
    expect(q.size).toBe(2);

    await expectAsync(p1).toBePending();
    await expectAsync(p2).toBePending();

    q.cancel('item #2');
    expect(q.size).toBe(1);
    await expectAsync(p1).toBePending();
    await expectAsync(p2).toBeRejectedWithError('This operation was aborted');

    let p1$2 = q.push('item #1');
    expect(q.size).toBe(1);
    expect(p1).not.toBe(p1$2);
    await expectAsync(p1).toBeRejectedWithError('This operation was aborted');
    await expectAsync(p1$2).toBePending();
  });

  it('can add a find handler to cancel similar items', async () => {
    let find = jasmine.createSpy('find', (a, b) => a.key === b.key);
    q.handle('find', find.and.callThrough());

    let p0 = q.push({ key: 0, value: '' });
    expect(find).not.toHaveBeenCalledWith();
    expect(q.size).toBe(1);

    let itemFoo = { key: 1, value: 'foo' };
    let promiseFoo = q.push(itemFoo);
    expect(q.size).toBe(2);

    expect(find).toHaveBeenCalledWith(itemFoo, jasmine.anything());
    await expectAsync(promiseFoo).toBePending();
    await expectAsync(p0).toBePending();

    let itemBar = { key: 1, value: 'bar' };
    let promiseBar = q.push(itemBar);
    expect(q.size).toBe(2);

    expect(find).toHaveBeenCalledWith(itemBar, itemFoo);
    await expectAsync(promiseBar).toBePending();
    await expectAsync(p0).toBePending();

    await expectAsync(promiseFoo)
      .toBeRejectedWithError('This operation was aborted');
  });

  it('can add a push handler to transform pushed items', async () => {
    let push = jasmine.createSpy('push', i => (i.pushed = true, i));
    q.handle('find', (a, b) => a.key === b.key);
    q.handle('push', push.and.callThrough());

    let itemFoo = { key: 1, value: 'foo' };
    let promiseFoo = q.push(itemFoo);

    expect(push).toHaveBeenCalledWith(itemFoo, undefined);
    expect(itemFoo).toHaveProperty('pushed', true);
    await expectAsync(promiseFoo).toBePending();

    let itemBar = { key: 1, value: 'bar' };
    let promiseBar = q.push(itemBar);

    expect(push).toHaveBeenCalledWith(itemBar, itemFoo);
    expect(itemBar).toHaveProperty('pushed', true);
    await expectAsync(promiseBar).toBePending();

    await expectAsync(promiseFoo)
      .toBeRejectedWithError('This operation was aborted');
  });

  it('can process any queued item once started', async () => {
    let p1 = q.push('item #1');
    let p2 = q.push('item #2');
    expect(q.size).toBe(2);

    await expectAsync(p1).toBePending();
    await expectAsync(p2).toBePending();

    let p2$2 = q.process('item #2');
    expect(q.size).toBe(2);
    expect(p2$2).toBe(p2);

    await expectAsync(p1).toBePending();
    await expectAsync(p2).toBePending();

    await q.start();
    expect(q.size).toBe(2);
    await q.process('item #2');
    expect(q.size).toBe(1);

    await expectAsync(p1).toBePending();
    await expectAsync(p2).toBeResolved();
  });

  it('can add a start handler that is called when starting', async () => {
    let start = jasmine.createSpy('start');
    q.handle('start', start);

    expect(start).not.toHaveBeenCalled();
    await q.start();
    await q.start();
    expect(start).toHaveBeenCalled();
  });

  it('can add a task handler for processing queued items', async () => {
    let task = jasmine.createSpy('task');
    q.handle('task', task);
    q.push('item #1');
    q.push('item #2');

    await q.start();
    expect(task).not.toHaveBeenCalled();

    await q.process('item #2');
    expect(task).toHaveBeenCalledWith('item #2');
  });

  it('can add an error handler to handle task errors', async () => {
    let err = new Error('testing');
    let error = jasmine.createSpy('error');
    q.handle('task', () => Promise.reject(err));
    q.handle('error', error);

    let p1 = q.push('item #1');
    q.run();

    await expectAsync(p1).toBeResolved();
    expect(error).toHaveBeenCalledWith('item #1', err);

    q.stop();
    let p2 = q.push('item #2');
    q.cancel('item #2');

    await expectAsync(p2).toBeResolved();
    expect(error).toHaveBeenCalledWith('item #2', (
      jasmine.objectContaining({
        name: 'AbortError',
        message: 'This operation was aborted'
      })
    ));
  });

  it('can start running queued items sequentially', async () => {
    let start = jasmine.createSpy('start');
    let task = jasmine.createSpy('task');
    q.handle('start', start);
    q.handle('task', task);

    let promises = Promise.all([
      q.push('item #1', 'foo'),
      q.push('item #2', 'bar'),
      q.push('item #3', 'baz')
    ]);

    expect(q.size).toBe(3);
    q.run();

    await expectAsync(promises).toBeResolved();
    expect(q.size).toBe(0);

    expect(start).toHaveBeenCalledBefore(task);
    expect(task.calls.allArgs()).toEqual([
      ['item #1', 'foo'],
      ['item #2', 'bar'],
      ['item #3', 'baz']
    ]);
  });

  it('can run as many queued items as concurrency allows', async () => {
    q.handle('task', item => waitForTimeout(item.timeout, item.value));
    q.set({ concurrency: 3 });

    let p1 = Promise.all([
      q.push({ value: 1, timeout: 100 }),
      q.push({ value: 2, timeout: 100 }),
      q.push({ value: 3, timeout: 100 })
    ]).then(() => q.stop());

    let p2 = Promise.all([
      q.push({ value: 4, timeout: 100 }),
      q.push({ value: 4, timeout: 100 }),
      q.push({ value: 6, timeout: 100 })
    ]);

    expect(q.size).toBe(6);
    q.run();

    await expectAsync(p1).toBeResolved();
    await expectAsync(p2).toBePending();
    expect(q.size).toBe(3);
  });

  it('can prevent items from being accepted when closed', async () => {
    let push = jasmine.createSpy('push');
    let task = jasmine.createSpy('task');
    q.handle('push', push);
    q.handle('task', task);

    let p1 = q.push('item #1');
    let p2 = q.push('item #2');
    expect(push).toHaveBeenCalledTimes(2);
    expect(task).not.toHaveBeenCalled();
    expect(q.size).toBe(2);

    q.close();
    let p3 = q.push('item #3');
    expect(push).toHaveBeenCalledTimes(2);
    expect(task).not.toHaveBeenCalled();
    expect(q.size).toBe(2);

    await expectAsync(p1).toBePending();
    await expectAsync(p2).toBePending();
    await expectAsync(p3).toBeRejectedWith(
      jasmine.objectContaining({ name: 'QueueClosedError' })
    );
  });

  it('can clear queued items when closing', async () => {
    let p1 = q.push('item #1');
    let p2 = q.push('item #2');
    expect(q.size).toBe(2);

    q.close(true);
    expect(q.size).toBe(0);

    await expectAsync(p1)
      .toBeRejectedWithError('This operation was aborted');
    await expectAsync(p2)
      .toBeRejectedWithError('This operation was aborted');
  });

  it('can add an end handler that is called when ending', async () => {
    let end = jasmine.createSpy('end');
    q.handle('end', end);

    let p1 = q.push('item #1');
    let p2 = q.push('item #2');
    q.close();

    expect(end).not.toHaveBeenCalled();
    await expectAsync(p1).toBePending();
    await expectAsync(p2).toBePending();

    await q.end();
    expect(end).toHaveBeenCalled();

    await expectAsync(p1)
      .toBeRejectedWithError('This operation was aborted');
    await expectAsync(p2)
      .toBeRejectedWithError('This operation was aborted');
  });

  it('waits for the start handler when ending early', async () => {
    let resolve, deferred = new Promise(r => (resolve = r));
    let start = jasmine.createSpy('start', () => deferred);
    q.handle('start', start.and.callThrough());
    q.start();

    let promise = q.end();
    await expectAsync(promise).toBePending();

    resolve();
    await expectAsync(promise).toBeResolved();
  });

  it('waits for the end handler when starting', async () => {
    let resolve, deferred = new Promise(r => (resolve = r));
    let end = jasmine.createSpy('end', () => deferred);
    q.handle('end', end.and.callThrough());
    q.end();

    let promise = q.start();
    await expectAsync(promise).toBePending();

    resolve();
    await expectAsync(promise).toBeResolved();
  });

  it('waits until started before running queued items', async () => {
    let resolve, deferred = new Promise(r => (resolve = r));
    let start = jasmine.createSpy('start', () => deferred);
    q.handle('start', start.and.callThrough());
    q.start();

    let promises = Promise.all([
      q.push('item #1'),
      q.push('item #2'),
      q.push('item #3')
    ]);

    q.run();
    await expectAsync(promises).toBePending();

    resolve();
    await expectAsync(promises).toBeResolved();
  });

  it('can run or close while starting', async () => {
    expect(q.readyState).toBe(0);
    await q.start();
    expect(q.readyState).toBe(1);

    await q.end();
    expect(q.readyState).toBe(0);
    q.handle('start', () => q.run());
    await q.start();
    expect(q.readyState).toBe(2);

    await q.end();
    expect(q.readyState).toBe(0);
    q.handle('start', () => q.close());
    await q.start();
    expect(q.readyState).toBe(3);
  });

  it('does nothing when stopping if not started or closed', async () => {
    expect(q.readyState).toBe(0);
    expect(q.stop().readyState).toBe(0);
    await q.start();
    expect(q.readyState).toBe(1);
    expect(q.run().readyState).toBe(2);
    expect(q.stop().readyState).toBe(1);
    expect(q.close().readyState).toBe(3);
    expect(q.stop().readyState).toBe(3);
  });

  it('does nothing when closing if already closed', () => {
    expect(q.readyState).toBe(0);
    expect(q.close().readyState).toBe(3);
    expect(q.close().readyState).toBe(3);
  });

  it('can wait until pending items idle', async () => {
    let resolve1, deferred1 = new Promise(r => (resolve1 = r));
    let resolve2, deferred2 = new Promise(r => (resolve2 = r));
    q.push(deferred1);
    q.push(deferred2);
    await q.start();
    q.run();

    let idle = jasmine.createSpy('idle');
    let promise = generatePromise(q.idle(idle));
    await expectAsync(promise).toBePending();
    expect(idle).toHaveBeenCalledWith(2);

    resolve1();
    await waitForTimeout(10);
    expect(idle.calls.count()).toBeGreaterThan(1);
    expect(idle).toHaveBeenCalledWith(1);

    await expectAsync(promise).toBePending();

    resolve2();
    await waitForTimeout(10);
    expect(idle.calls.count()).toBeGreaterThan(2);
    expect(idle).toHaveBeenCalledWith(0);

    await expectAsync(promise).toBeResolved();
  });

  it('can flush currently queued items', async () => {
    let resolve, deferred = new Promise(r => (resolve = r));

    q.push('item #1');
    q.push('item #2');
    q.push('item #3');
    q.push(deferred);

    expect(q.size).toBe(4);

    let promise = generatePromise(q.flush());
    await expectAsync(promise).toBePending();

    q.push('item #5');
    q.push('item #6');

    expect(q.size).toBe(3);

    resolve();
    await expectAsync(promise).toBeResolved();

    expect(q.size).toBe(2);
  });

  it('can flush twice without interruption', async () => {
    let resolve1, deferred1 = new Promise(r => (resolve1 = r));
    let resolve2, deferred2 = new Promise(r => (resolve2 = r));

    q.push(deferred1);
    let p1 = generatePromise(q.flush());
    await expectAsync(p1).toBePending();

    q.push(deferred2);
    let p2 = generatePromise(q.flush());
    await expectAsync(p2).toBePending();

    resolve1();
    await expectAsync(p1).toBeResolved();
    await expectAsync(p2).toBePending();

    resolve2();
    await expectAsync(p2).toBeResolved();
  });

  it('cancels the flush when aborted', async () => {
    let resolve, deferred = new Promise(r => (resolve = r));
    let p1 = q.push(deferred);
    let p2 = q.push('flush');

    q.set({ concurrency: 1 });
    let ctrl = new AbortController();
    let flush = generatePromise(q.flush(), ctrl.signal);
    await expectAsync(flush).toBePending();
    await expectAsync(p1).toBePending();
    await expectAsync(p2).toBePending();

    ctrl.abort();
    await expectAsync(flush)
      .toBeRejectedWithError('This operation was aborted');

    resolve();
    await expectAsync(p1).toBeResolved();
    await expectAsync(p2).toBePending();
  });
});
