
import os from 'os';
import fs from 'fs';
import logger from '@percy/logger';

const CGROUP_CPU_STATS = '/sys/fs/cgroup/cput.stats';
const CGROUP_CPU_MAX = '/sys/fs/cgroup/cpu.max';
const CGROUP_FILES = [CGROUP_CPU_MAX, CGROUP_CPU_STATS];
const log = logger('monitoring:cpu');

async function getCPULoadInfo(os, { containerLevel, machineLevel = true }) {
  try {
    if (os.includes('linux') && cgroupExists()) {
      return await getLinuxCPULoad();
    } else {
      return await getCPULoad();
    }
  } catch (error) {
    // Don't raise this error to avoid user build failure
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
 * reading cpu stats from cgroup files
 */
function readCpuStatFromCgroup() {
  const content = fs.readFileSync(CGROUP_CPU_STATS, 'utf8');
  const stats = {};

  // Parse the cpu.stat file
  content.split('\n').forEach(line => {
    const [key, value] = line.trim().split(' ');
    if (key && value) {
      stats[key] = parseInt(value);
    }
  });

  return stats;
}

/**
 * linux cpu load is calculated is same for
 * containerLevel and machineLevel
 */
async function getLinuxCPULoad() {
  try {
    // Read cpu.max for quota and period
    const cpuMaxContent = fs.readFileSync(CGROUP_CPU_MAX, 'utf8');
    const [quotaStr, periodStr] = cpuMaxContent.trim().split(' ');
    let quota, period, availableCPUs;

    if (quotaStr === 'max') {
      // No quota set, use the number of physical CPUs
      const physicalCPUs = os.cpus().length;
      quota = null; // Indicate no quota
      period = null; // Indicate no period
      availableCPUs = physicalCPUs;
    } else {
      // Parse quota and period values
      quota = parseInt(quotaStr);
      period = parseInt(periodStr);
      availableCPUs = quota / period;
    }

    // Get first CPU usage reading
    const startStats = readCpuStatFromCgroup();

    // Wait for 1 second, ie 10^6 microsecod
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Get second CPU usage reading
    const endStats = readCpuStatFromCgroup();

    // Calculate CPU usage
    const usageDelta = endStats.usage_usec - startStats.usage_usec;

    // Calculate percentage (similar to previous implementation)
    // usageDelta is in microseconds, we measured over 1 second (1_000_000 microseconds)
    // NOTE: cpuPercentage can be > 100% as something process can use
    // more than allocated cpu range
    const cpuPercent = (usageDelta / (1_000_000 * availableCPUs)) * 100;

    return {
      availableCPUs,
      usagePercent: cpuPercent
    };
  } catch (error) {
    // TODO: Log error here
    return null;
  }
}

async function computeCpuUsageStats() {
  let totalTickTime = 0;
  let totalIdleTime = 0;
  os.cpus().forEach(cpu => {
    for (let type in cpu.times) {
      totalTickTime += cpu.times[type];
    }
    totalIdleTime += cpu.times.idle;
  });
  return { totalTickTime, totalIdleTime };
};

/**
 * this is a fallback method, if
 * 1. For LINUX, we can't find cgroup details
 * 2. For Win/OSX operating system
 */
async function getCPULoad() {
  const initialCpuUsage = await computeCpuUsageStats();
  // wait for 1 second, to connect cpu load for 10^6 micro-second
  // ie. 1 second
  await new Promise((res) => setTimeout(res(), 1000));

  const finalCpuUsage = await computeCpuUsageStats();

  // Calculate differences
  const deltaTick = finalCpuUsage.totalTickTime - initialCpuUsage.totalTickTime;
  const deltaIdle = finalCpuUsage.totalIdleTime - initialCpuUsage.totalIdleTime;

  // Calculate % usage
  const cpuUsagePercent = (1 - deltaIdle / deltaTick) * 100;
  return {
    availableCPUs: os.cpus().length,
    usagePercent: cpuUsagePercent
  };
}

export {
  getCPULoadInfo
};
