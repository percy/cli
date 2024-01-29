import percy from './percy-info.js';
import request from './request.js';

// Post snapshot data to the CLI snapshot endpoint. If the endpoint responds with a build error,
// indicate that Percy has been disabled.
export async function postSnapshot(options, params) {
  let query = params ? `?${new URLSearchParams(params)}` : '';

  return await request.post(`/percy/snapshot${query}`, options).catch(err => {
    if (err.response?.body?.build?.error) {
      percy.enabled = false;
    } else {
      throw err;
    }
  });
}

export default postSnapshot;
