import percy from './percy-info.js';
import request from './request.js';

// Post comparison data to the CLI comparison endpoint. If the endpoint responds with a build error,
// indicate that Percy has been disabled.
//
// Sync-assertion mode (Option C): when `options.sync` is set (or the global .percy.yml
// `snapshot.sync` is on), the CLI awaits the per-comparison verdict and returns it in
// `response.body.data` (the sync-cli comparison detail, or `{ error }` on timeout/403/CLI-exit).
// We surface that result directly so SDK callers (the Playwright drop-in) can classify it; the
// fire-and-forget path keeps returning the raw response (backward compatible).
export async function postComparison(options, params) {
  let query = params ? `?${new URLSearchParams(params)}` : '';

  let response = await request.post(`/percy/comparison${query}`, options).catch(err => {
    if (err.response?.body?.build?.error) {
      percy.enabled = false;
    } else {
      throw err;
    }
  });

  // In sync mode the server returns the per-comparison verdict under `data`; hand it back so the
  // caller can apply its pass/fail classifier. Otherwise return the raw response unchanged.
  if (response?.body && Object.prototype.hasOwnProperty.call(response.body, 'data')) {
    return response.body.data;
  }
  return response;
}

export default postComparison;
