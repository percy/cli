import request from './request.js';
import logger from './logger.js';

// Gets computed responsive widths from the Percy server for responsive snapshot capture
export async function getResponsiveWidths(widths = []) {
  try {
    // Ensure widths is an array
    const widthsArray = Array.isArray(widths) ? widths : [];
    const queryParam = widthsArray.length > 0 ? `?widths=${widthsArray.join(',')}` : '';
    const response = await request(`/percy/widths-config${queryParam}`);
    return response.body?.widths || [];
  } catch (error) {
    // Log error and return empty array as fallback
    logger('sdk-utils:responsive-widths').debug(`Failed to get responsive widths: ${error.message}`);
    return [];
  }
}

export default getResponsiveWidths;
