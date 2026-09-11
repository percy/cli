import percy from './percy-info.js';
import request from './request.js';

export async function postPdfSnapshot(options, params) {
  let query = params ? `?${new URLSearchParams(params)}` : '';

  return await request.post(`/percy/pdf/snapshot${query}`, options).catch(err => {
    if (err.response?.body?.build?.error) {
      percy.enabled = false;
    } else {
      throw err;
    }
  });
}

export default postPdfSnapshot;
