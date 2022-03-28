import percy from './percy-info.js';
import request from './request.js';

// Fetch and cache the @percy/dom script
export async function fetchPercyDOM() {
  if (percy.domScript == null) {
    let response = await request('/percy/dom.js');
    percy.domScript = response.body;
  }

  return percy.domScript;
}

export default fetchPercyDOM;
