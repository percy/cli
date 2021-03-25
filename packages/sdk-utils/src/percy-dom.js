import percy from './percy-info';
import request from './request';

// Fetch and cache the @percy/dom script
export default async function fetchPercyDOM() {
  if (percy.domScript == null) {
    let response = await request('/percy/dom.js');
    percy.domScript = response.body;
  }

  return percy.domScript;
}
