import percy from './percy-info.js';
import request from './request.js';

// Posts to the local Percy server one or more snapshots to flush. Given no arguments, all snapshots
// will be flushed. Does nothing when Percy is not enabled.
export async function flushSnapshots(options) {
  if (percy.enabled) {
    // accept one or more snapshot names
    options &&= [].concat(options).map(o => (
      typeof o === 'string' ? { name: o } : o
    ));

    await request.post('/percy/flush', options);
  }
}

export default flushSnapshots;
