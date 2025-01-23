import fs from 'fs';
import si from 'systeminformation';
import logger from '@percy/logger';

const CGROUP_MEMORY_CURRENT = '/sys/fs/cgroup/memory.current';
const CGROUP_MEMORY_MAX = '/sys/fs/cgroup/memory.max';
const CGROUP_FILES = [CGROUP_MEMORY_CURRENT, CGROUP_MEMORY_MAX];
const log = logger('monitoring:memory');

async function getMemoryUsageInfo(os, { containerLevel, machineLevel = true }) {
  try {
    if (os.includes('linux') && cgroupExists()) {
      // TODO: Try to handle the fallback method
      // this throws error
      return await getLinuxMemoryUsage();
    } else {
      return await getMemoryUsage();
    }
  } catch (error) {
    // TODO: gojo error
    log.debug('Error: ', error);
    return null;
  }
}

function cgroupExists() {
  // Check if cgroup files are avaiable for not
  let cgroupExists = true;
  for (const file in CGROUP_FILES) {
    cgroupExists &&= fs.existsSync(file);
  }
  return cgroupExists;
}

/**
 * get memory usage using linux c_group ( control group )
 */
async function getLinuxMemoryUsage() {
  // TODO: if memory_max == max ( take system max value )
  let maxAllocatedMemory = fs.readFileSync(CGROUP_MEMORY_MAX);

  // When there is no limit set, it's the max value
  if (maxAllocatedMemory === 'max') {
    maxAllocatedMemory = await si.mem().total;
  } else maxAllocatedMemory = parseInt(maxAllocatedMemory);

  const currentMemoryUsage = parseInt(fs.readFileSync(CGROUP_MEMORY_CURRENT));
  return (currentMemoryUsage / maxAllocatedMemory) * 100;
}

/**
 * this is fallback method, for
 * 1. LINUX, if cgroups files doesn't exists
 * 2. MacOSX, Windows based OS
 */
async function getMemoryUsage() {
  // Get total and free memory
  const memInfo = await si.mem();
  const totalMemory = memInfo.total;
  const freeMemory = memInfo.available;

  // Calculate memory usage percentage
  const usedMemory = totalMemory - freeMemory;
  const memoryUsagePercentage = (usedMemory / totalMemory) * 100;

  return {
    usagePercent: memoryUsagePercentage.toFixed(2)
  };
}
export {
  getMemoryUsageInfo
};
