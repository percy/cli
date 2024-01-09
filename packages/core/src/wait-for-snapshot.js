import logger from '@percy/logger';

const MIN_POLLING_INTERVAL = 5_000;
// Poll atleast once in 2 min
const MAX_POLLING_INTERVAL = 120; // in seconds
const THRESHOLD_OPTIMAL_POLL_TIME = 5;

export class WaitForSnapshot {
  log = logger('core:wait-for-snapshot');

  constructor(type, percy) {
    this.percy = percy;
    this.snapshots = [];
    if (type !== 'comparison' && type !== 'snapshot') throw new Error('Type should be either comparison or snapshot');
    this.type = type;
    this.timer = null;
    this.exit = false;
    this.running = false;
  }

  push(snapshot) {
    if (!(snapshot instanceof SnapshotData)) throw new Error('Invalid snapshot passed, use SnapshotData');

    this.snapshots.push(snapshot);
    if (!this.running) this.run();
  }

  run(interval = MIN_POLLING_INTERVAL) {
    if (this.exit) return;
    this.running = true;

    if (interval < MIN_POLLING_INTERVAL) {
      interval = MIN_POLLING_INTERVAL;
    }

    this.log.debug(`Polling for snapshot status in ${interval}ms`);
    this.timer = setTimeout(async () => {
      const snapshotIds = this.snapshots.map(snap => snap.id);
      const response = await this.percy.client.getStatus(this.type, snapshotIds);

      let nextPoll = MAX_POLLING_INTERVAL;
      const now = Math.floor(Date.now() / 1000);

      this.snapshots = this.snapshots.filter((snapshot) => {
        if (response[snapshot.id]) {
          const snapshotStatus = response[snapshot.id];
          if (snapshotStatus.status) {
            snapshot.resolve(snapshot.id);
            return false;
          } else if (snapshotStatus.error != null) {
            snapshot.reject(snapshotStatus.error);
            return false;
          } else {
            snapshot.nextPoll = snapshotStatus.next_poll;
          }
        }
        nextPoll = Math.min(nextPoll, snapshot.nextPoll - now);
        return true;
      });

      if (this.snapshots.length === 0) {
        this.running = false;
        return;
      }
      const optimalNextPollTime = this.getOptimalPollTime(nextPoll, now);
      this.run(optimalNextPollTime * 1000);
    }, interval);
  }

  // If there are other snapshots which can be completed in next
  // 5 seconds, calling after x seconds will reduce network call
  getOptimalPollTime(lowestPollTime, now) {
    let pollTime = lowestPollTime;
    this.snapshots.forEach((snapshot) => {
      const snaphotPollTime = snapshot.nextPoll - now;
      if (snaphotPollTime - lowestPollTime <= THRESHOLD_OPTIMAL_POLL_TIME) {
        pollTime = Math.max(pollTime, snaphotPollTime);
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
  constructor(id, nextPoll, resolve, reject) {
    if (!nextPoll) nextPoll = Math.floor(Date.now() / 1000) + 60;
    this.id = id;
    this.nextPoll = nextPoll;
    this.resolve = resolve;
    this.reject = reject;
  }
}
