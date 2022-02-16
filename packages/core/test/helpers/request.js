import req from '@percy/client/dist/request';

export async function request(url, method = 'GET', handle) {
  if (typeof method === 'boolean' || typeof method === 'function') [handle, method] = [method, 'GET'];
  let cb = typeof handle === 'boolean' ? (handle ? (...a) => a : (_, r) => r) : handle;
  let options = typeof method === 'string' ? { method } : method;

  try { return await req(url, options, cb); } catch (error) {
    if (typeof handle !== 'boolean') throw error;
    return handle ? [error.response.body, error.response] : error.response;
  }
}

export default request;
