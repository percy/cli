import request from './request';

// Post snapshot data to the snapshot endpoint
export default async function postSnapshot(options) {
  await request('/percy/snapshot', {
    method: 'POST',
    body: JSON.stringify(options)
  });
}
