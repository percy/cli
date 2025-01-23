
import os from 'os'
import fs from 'fs'
import { getCPULoadInfo } from './cpu.js'
import { getMemoryUsageInfo } from './memory.js'

export default class Monitoring {
  constructor() {
    this.os = this.getOS()
    this.isContainer = this.isContainerLevel()
    this.isMachine = this.isMachineLevel()
    this.pod = this.isPodLevel()
    this.cpuInfo = {}
    this.memoryUsageInfo = {}
  }

  getOS() {
    return os.platform()
  }

  isContainerLevel() {
    return fs.existsSync('/.dockerenv')
  }

  isPodLevel() {
    return fs.existsSync('/var/run/secrets/kubernetes.io')
  }
  
  isMachineLevel() {
    return !this.isContainerLevel()
  }

  /**
   * It will start monitoring at certain interval
   * by default every 5 seconds
   */
  startMonitoring(interval=5) {
    setInterval(() => {
      this.monitoringCPULoad()
      this.monitoringCPULoad()
    }, interval)
  }

  async monitoringCPULoad() {
    const cpuInfo = await getCPULoadInfo(this.os, { containerLevel: this.isContainer, machineLevel: this.isMachine})
    this.cpuInfo = cpuInfo
  }

  async monitorMemoryUsage() {
    const memoryInfo = await getMemoryUsageInfo(this.os, { containerLevel: this.isContainer, machineLevel: this.isMachine})
    this.memoryUsageInfo = memoryInfo
  }

  // Whenever, this will get called to get
  // cpu and memory usage info
  getMonitoringInfo() {
    return {
      cpuInfo: this.cpuInfo,
      memoryUsageInfo: this.memoryUsageInfo
    }
  }
}