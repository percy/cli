import request from './request';

const RETRY_ERROR_CODES = ['ECONNRESET', 'ETIMEDOUT'];

export async function waitForPercyIdle() {
  try {
    return !!(await request('/percy/idle'));
  } catch (e) {
    return RETRY_ERROR_CODES.includes(e.code) && waitForPercyIdle();
  }
}

export default waitForPercyIdle;
