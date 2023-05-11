import percy from './percy-info.js';
import request from './request.js';

// Post screenshot data to the CLI automateScreenshot endpoint. If the endpoint responds with a build error,
// indicate that Percy has been disabled.
export async function postScreenshot(options, params) {
  let query = params ? `?${new URLSearchParams(params)}` : '';

  await request.post(`/percy/automateScreenshot${query}`, options).catch(err => {
    if (err.response?.body?.build?.error) {
      percy.enabled = false;
    } else {
      throw err;
    }
  });
}

export default postScreenshot;
