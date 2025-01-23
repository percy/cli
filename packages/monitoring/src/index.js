
import os from 'os';
import fs from 'fs';
import { getCPULoadInfo } from './cpu.js';
import { getMemoryUsageInfo } from './memory.js';
import logger from '@percy/logger';
export default class Monitoring {
  constructor() {
    this.os = this.getOS();
    this.monitoringId = null;
    this.running = false;
    this.isContainer = this.isContainerLevel();
    this.isMachine = this.isMachineLevel();
    this.pod = this.isPodLevel();
    this.cpuInfo = {};
    this.memoryUsageInfo = {};
    this.log = logger('monitoring');
  }

  getOS() {
    return os.platform();
  }

  isContainerLevel() {
    return fs.existsSync('/.dockerenv');
  }

  isPodLevel() {
    return fs.existsSync('/var/run/secrets/kubernetes.io');
  }

  isMachineLevel() {
    return !this.isContainerLevel();
  }

  /**
   * It will start monitoring at certain interval
   * by default every 5 seconds
   */
  async startMonitoring(interval = 5000) {
    // early return if already monitoring
    if (this.monitoringId) return;

    await this.executeMonitoring();
    this.monitoringId = setInterval(() => {
      // Let it be async
      this.executeMonitoring();
    }, interval);
    this.log.debug('Started monitoring sytem metrics');
  }

  async executeMonitoring() {
    this.running = true;
    await this.monitoringCPULoad();
    await this.monitorMemoryUsage();
  }

  stopMonitoring() {
    if (this.monitoringId) {
      clearInterval(this.monitoringId);
      this.monitoringId = null;
      this.cpuInfo = {};
      this.memoryUsageInfo = {};
      this.running = false;
      this.log.debug('Stopped monitoring sytem metrics');
    }
  }

  async monitoringCPULoad() {
    const cpuInfo = await getCPULoadInfo(this.os, { containerLevel: this.isContainer, machineLevel: this.isMachine });
    // TODO: GOJO remove this
    this.cpuInfo = cpuInfo;
    console.log('--->> cpu info', cpuInfo);
  }

  async monitorMemoryUsage() {
    const memoryInfo = await getMemoryUsageInfo(this.os, { containerLevel: this.isContainer, machineLevel: this.isMachine });
    // TODO: GOJO remove this
    console.log('mem info -->> ', memoryInfo);
    this.memoryUsageInfo = memoryInfo;
  }

  // Whenever, this will get called to get
  // cpu and memory usage info
  getMonitoringInfo() {
    return {
      cpuInfo: this.cpuInfo,
      memoryUsageInfo: this.memoryUsageInfo
    };
  }
}
