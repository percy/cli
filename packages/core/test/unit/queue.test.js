import expect from 'expect';
import Queue from '../../src/queue';

function task(timeout = 0, cb) {
  return async function t() {
    t.running = true;
    await new Promise(r => setTimeout(r, timeout));
    let v = cb && await cb();
    t.running = false;
    return v;
  };
}

describe('Unit / Tasks Queue', () => {
  let q;

  beforeEach(() => {
    q = new Queue(2);
  });

  it('has a default concurrency', () => {
    expect(new Queue()).toHaveProperty('concurrency', Infinity);
  });

  it('can set a specific concerrency', () => {
    expect(q).toHaveProperty('concurrency', 2);
  });

  describe('#push()', () => {
    it('runs each task concurrently within the limit', () => {
      let tasks = Array(4).fill().map(() => task(100));
      tasks.forEach(t => q.push(t));

      expect(tasks[0]).toHaveProperty('running', true);
      expect(tasks[1]).toHaveProperty('running', true);
      expect(tasks[2]).not.toHaveProperty('running');
      expect(tasks[3]).not.toHaveProperty('running');
    });

    it('resolves or rejects when the task completes', async () => {
      let n = 0;
      q.push(task(50, () => n++));

      expect(n).toBe(0);
      await expect(q.push(task(100, () => n++))).resolves.toBe(1);
      expect(n).toBe(2);

      await expect(q.push(task(0, () => {
        throw new Error('some error');
      }))).rejects.toThrow('some error');
    });
  });

  describe('#length', () => {
    it('returns the number of all incomplete tasks', async () => {
      let tasks = Array(10).fill().map(() => q.push(task(100)));

      expect(q.length).toBe(10);
      await tasks[1]; // wait for the first set of tasks to complete
      expect(q.length).toBe(8);
    });
  });

  describe('#idle()', () => {
    it('resolves when all tasks settle', async () => {
      let tasks = Array(5).fill().map(() => task(100));
      tasks.forEach(t => q.push(t));

      q.push(task(50, () => {
        // a rejected task should not interrupt #idle()
        throw new Error('technically settled');
      })).catch(() => {}); // we're catching the promise, not the task

      await expect(q.idle()).resolves.toBeUndefined();
      tasks.forEach(t => expect(t).toHaveProperty('running', false));
    });
  });

  describe('#clear()', () => {
    it('removes tasks from the queue', async () => {
      let tasks = Array(10).fill().map(() => q.push(task(100)));
      q.clear();

      // the first set of tasks is already running, the queue length will return
      // 2 unless we wait for them to settle
      await tasks[1];

      expect(q.length).toBe(0);
      expect(tasks[2]).not.toHaveProperty('running');
    });
  });
});
