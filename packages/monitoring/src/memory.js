import os from 'os'
import fs from 'fs'

const CGROUP_MEMORY_CURRENT = '/sys/fs/cgroup/memory.current'
const CGROUP_MEMORY_MAX = '/sys/fs/cgroup/memory.max'
const CGROUP_FILES = [CGROUP_MEMORY_CURRENT, CGROUP_MEMORY_MAX]

async function getMemoryUsageInfo(os, { containerLevel, machineLevel=true}) {
  if (os.includes('linux') && cgroupExists()) {
    return await getLinuxMemoryUsage()
  } else {
    return await getMemoryUsage()
  }
}

function cgroupExists() {
  // Check if cgroup files are avaiable for not
  let cgroupExists = true
  for (file in CGROUP_FILES) {
    cgroupExists &&= fs.existsSync(file)
  }
  return cgroupExists
}

async function getLinuxMemoryUsage() {
  try {
    const maxAllocatedMemory = fs.readFileSync(CGROUP_MEMORY_MAX)
    const currentMemoryUsage = fs.readFileSync(CGROUP_MEMORY_CURRENT)
    return (currentMemoryUsage/maxAllocatedMemory) * 100
  } catch (error) {
    // TOOD: LOG here gojo
    console.log('--->> error gojo ', error)
    return null
  }
}

/**
 * this is fallback method, for
 * 1. LINUX, if cgroups files doesn't exists
 * 2. MacOSX, Windows based OS
 */
async function getMemoryUsage() {
  // Get total and free memory
  const totalMemory = os.totalmem()
  const freeMemory = os.freemem()
  // Calculate memory usage percentage
  const usedMemory = totalMemory - freeMemory;
  const memoryUsagePercentage = (usedMemory / totalMemory) * 100;

  //TODO: remove this gojo
  console.log(`Total Memory: ${(totalMemory / (1024 ** 3)).toFixed(2)} GB`);
  console.log(`Used Memory: ${(usedMemory / (1024 ** 3)).toFixed(2)} GB`);
  console.log(`Memory Usage: ${memoryUsagePercentage.toFixed(2)}%`);
  return memoryUsagePercentage
}
export {
  getMemoryUsageInfo
}