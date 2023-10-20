import request from './request.js';

// Post failed event data to the CLI event endpoint.
export async function postFailedEvent(options) {
  return await request.post('/percy/events', options).catch(err => {
    throw err;
  });
}

export default postFailedEvent;
