import { promisify } from 'util';
import { exec as callbackExec } from 'child_process';

const exec = promisify(callbackExec);

/**
 * Gets available disk space for the primary system partition.
 * @param {string} platform - The OS platform ('win32', 'linux', 'darwin').
 * @returns {Promise<string>} The available disk space (e.g., "123.45 gb") or 'N/A'.
 */
export async function getDiskSpaceInfo(platform) {
  try {
    if (platform === 'win32') {
      // For Windows, use wmic to get FreeSpace on the C: drive. This is standard for PCs.
      const { stdout } = await exec('wmic logicaldisk where "DeviceID=\'C:\'" get FreeSpace /value');
      const freeSpaceBytes = parseInt(stdout.trim().split('=')[1], 10);
      if (isNaN(freeSpaceBytes)) return 'N/A';
      // Convert bytes to GB: bytes / (1024^3)
      return `${(freeSpaceBytes / (1024 ** 3)).toFixed(2)} gb`;
    } else {
      // For macOS and Linux, 'df' checks the root partition. This is the standard for Unix-based PCs.
      const { stdout } = await exec('df -k /');
      const lines = stdout.trim().split('\n');
      const availableKB = parseInt(lines[1].split(/\s+/)[3], 10);
      if (isNaN(availableKB)) return 'N/A';
      // Convert kilobytes to GB: KB / (1024^2)
      return `${(availableKB / (1024 ** 2)).toFixed(2)} gb`;
    }
  } catch (error) {
    // If the command fails for any reason, gracefully return 'N/A'.
    return 'N/A';
  }
}