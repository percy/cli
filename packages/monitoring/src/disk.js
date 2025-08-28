import { promisify } from 'util';
import { exec as callbackExec } from 'child_process';

// We wrap the dependency in an object so we can easily mock it
export const dependencies = {
  defaultExec: promisify(callbackExec)
};

/**
 * Gets available disk space for the primary system partition.
 * @param {string} platform - The OS platform ('win32', 'linux', 'darwin').
 * @param {function} exec - Optional exec function for testing.
 * @returns {Promise<string>} The available disk space (e.g., "123.45 gb") or 'N/A'.
 */
export async function getDiskSpaceInfo(platform, exec = dependencies.defaultExec) {
  try {
    if (platform === 'win32') {
      const { stdout } = await exec('wmic logicaldisk where "DeviceID=\'C:\'" get FreeSpace /value');
      const freeSpaceBytes = Number(stdout.trim().split('=')[1]);
      if (isNaN(freeSpaceBytes)) return 'N/A';
      return `${(freeSpaceBytes / (1024 ** 3)).toFixed(2)} gb`;
    } else {
      const { stdout } = await exec('df -k /');
      const lines = stdout.trim().split('\n');
      const availableKB = Number(lines[1].split(/\s+/)[3]);
      if (isNaN(availableKB)) return 'N/A';
      return `${(availableKB / (1024 ** 2)).toFixed(2)} gb`;
    }
  } catch (error) {
    return 'N/A';
  }
}
