import logger from '@percy/logger';

const MIN_POLLING_INTERVAL = 5_000;

export class WaitForSnapshot {
  log = logger('core:wait-for-snapshot');

  constructor(type, percy) {
    this.percy = percy;
    this.snapshots = [];
    if (type !== 'comparison' && type !== 'snapshot') throw new Error('Type should be either comparison or snapshot');
    // snapshot || comparison
    this.type = type;
    this.timer = null;
    this.exit = false;
    this.running = false;
  }

  push(snapshot) {
    if (!(snapshot instanceof SnapshotData)) return;

    this.snapshots.push(snapshot);
    if (!this.running) this.run();
  }

  run(interval = MIN_POLLING_INTERVAL) {
    if (this.exit) return;
    this.running = true;

    if (interval < MIN_POLLING_INTERVAL) {
      interval = MIN_POLLING_INTERVAL;
    }

    this.timer = setTimeout(async () => {
      const snapshotIds = this.snapshots.map(snap => snap.id);
      const response = await this.percy.client.getStatus(this.type, snapshotIds);

      // Poll atleast once in 2 min
      let nextPoll = 120;
      const now = Math.floor(Date.now() / 1000);

      this.snapshots = this.snapshots.filter((snapshot) => {
        if (response[snapshot.id]) {
          const snapstatus = response[snapshot.id];
          if (snapstatus.status) {
            this.log.debug(`Resolving snapshot ${snapshot.id}`);
            snapshot.resolve(snapshot.id);
            return false;
          } else if (snapstatus.error != null) {
            this.log.debug(`Rejecting snapshot ${snapshot.id}`);
            snapshot.reject(snapstatus.error);
            return false;
          } else {
            // Poll after miniumum time returned
            nextPoll = Math.min(nextPoll, snapstatus.next_poll - now);
            snapshot.time = snapstatus.next_poll;
          }
        }
        return true;
      });

      if (this.snapshots.length === 0) {
        this.running = false;
        return;
      }
      const optimalNextPollTime = this.getOptimalPollTime(nextPoll, now);
      this.log.debug(`RUNNING AGAIN after ${optimalNextPollTime}`);
      this.run(optimalNextPollTime * 1000);
    }, interval);
  }

  // If there are other snapshots which can be completed in next
  // 5 seconds, calling after x seconds will reduce network call
  getOptimalPollTime(lowestPollTime, now) {
    let pollTime = lowestPollTime;
    this.snapshots.forEach((snap) => {
      const snapPollTime = snap.nextPoll - now;
      if (snapPollTime - lowestPollTime <= 5) {
        pollTime = Math.max(pollTime, snapPollTime);
      }
    });
    return pollTime;
  }

  stop() {
    this.exit = true;
    if (this.timer) clearTimeout(this.timer);
  }
}

export class SnapshotData {
  constructor(id, time, resolve, reject) {
    this.id = id;
    this.time = time;
    this.resolve = resolve;
    this.reject = reject;
  }
}
