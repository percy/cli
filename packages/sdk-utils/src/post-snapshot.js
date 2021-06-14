import percy from './percy-info';
import request from './request';

// Post snapshot data to the snapshot endpoint. If the snapshot endpoint responds with a closed
// error message, signal that Percy has been disabled.
export default async function postSnapshot(options) {
  await request('/percy/snapshot', {
    method: 'POST',
    body: JSON.stringify(options)
  }).catch(err => {
    if (err.response && err.message === 'Closed') {
      percy.enabled = false;
    } else {
      throw err;
    }
  });
}
