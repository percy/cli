import Queue from '../../src/queue';

function task(timeout = 0, cb) {
  return async function t() {
    t.running = true;
    await new Promise(r => setTimeout(r, timeout));
    let v = cb && (await cb());
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
    expect(new Queue()).toHaveProperty('concurrency', 5);
  });

  it('can set a specific concurrency', () => {
    expect(q).toHaveProperty('concurrency', 2);
  });

  describe('#push()', () => {
    it('runs each task concurrently within the limit', () => {
      let tasks = Array(4).fill().map(() => task(100));
      tasks.forEach((t, i) => q.push(i, t));

      expect(tasks[0]).toHaveProperty('running', true);
      expect(tasks[1]).toHaveProperty('running', true);
      expect(tasks[2]).not.toHaveProperty('running');
      expect(tasks[3]).not.toHaveProperty('running');
    });

    it('resolves or rejects when the task completes', async () => {
      let n = 0;
      q.push(0, task(50, () => n++));

      expect(n).toBe(0);
      await expectAsync(q.push(1, task(100, () => n++))).toBeResolvedTo(1);
      expect(n).toBe(2);

      await expectAsync(q.push(2, task(0, () => {
        throw new Error('some error');
      }))).toBeRejectedWithError('some error');
    });

    it('can run tasks according to priority', async () => {
      let done = [];

      for (let i = 0; i < 4; i++) {
        q.push(i, task(100, () => done.push(i)));
      }

      await Promise.all([
        q.push(4, task(100, () => done.push(4)), 10),
        q.push(5, task(100, () => done.push(5)), 10),
        q.push(6, task(100, () => done.push(6)), 5)
      ]);

      expect(done).toEqual([0, 1, 6, 4, 5]);

      await q.idle();

      expect(done).toEqual([0, 1, 6, 4, 5, 2, 3]);
    });
  });

  describe('#length', () => {
    it('returns the number of all incomplete tasks', async () => {
      let tasks = Array(10).fill().map((_, i) => q.push(i, task(100)));

      expect(q.length).toBe(10);
      await tasks[1]; // wait for the first set of tasks to complete
      expect(q.length).toBe(8);
    });
  });

  describe('#idle()', () => {
    it('resolves when all tasks settle', async () => {
      let tasks = Array(5).fill().map(() => task(100));
      tasks.forEach((t, i) => q.push(i, t));

      q.push('err', task(50, () => {
        // a rejected task should not interrupt #idle()
        throw new Error('technically settled');
      })).catch(() => {}); // we're catching the promise, not the task

      await expectAsync(q.idle()).toBeResolved();
      tasks.forEach(t => expect(t).toHaveProperty('running', false));
    });
  });

  describe('#clear()', () => {
    it('removes tasks from the queue', async () => {
      let tasks = Array(10).fill().map((_, i) => q.push(i, task(100)));
      q.clear();

      // the first set of tasks is already running, the queue length will return
      // 2 unless we wait for them to settle
      await tasks[1];

      expect(q.length).toBe(0);
      expect(tasks[2]).not.toHaveProperty('running');
    });
  });
});
