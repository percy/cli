import request from './request.js';
import logger from './logger.js';

// Gets computed responsive widths from the Percy server for responsive snapshot capture
export async function getResponsiveWidths(widths = []) {
  let log = logger('utils');
  try {
    // Ensure widths is an array
    const widthsArray = Array.isArray(widths) ? widths : [];
    const queryParam = widthsArray.length > 0 ? `?widths=${widthsArray.join(',')}` : '';
    const response = await request(`/percy/widths-config${queryParam}`);
    return Array.isArray(response.body?.widths) ? response.body.widths : [];
  } catch (error) {
    // Log error and return empty array as fallback
    log.debug(`Failed to get responsive widths: ${error.message}`);
    return [];
  }
}

export default getResponsiveWidths;
