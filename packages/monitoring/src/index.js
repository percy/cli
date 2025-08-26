import fs from 'fs';
import os from 'os';
import logger from '@percy/logger';
import { getCPUUsageInfo, getClientCPUDetails } from './cpu.js';
import { getMemoryUsageInfo, getClientMemoryDetails } from './memory.js';
import { exec as callbackExec } from 'child_process';
import { promisify } from 'util'

const exec = promisify(callbackExec);

export default class Monitoring {
  constructor() {
    this.os = this.getOS();
    this.monitoringId = null;
    this.running = false;
    this.isContainer = this.isContainerLevel();
    this.isPod = this.isPodLevel();
    this.isMachine = this.isMachineLevel();
    this.lastExecutedAt = null;
    this.pod = this.isPodLevel();
    this.cpuInfo = {};
    this.memoryUsageInfo = {};
    this.log = logger('monitoring');
  }

  getOS() {
    return os.platform();
  }

  getPercyEnv() {
    const percyKeys = Object.keys(process.env).filter(env => env.toLowerCase().includes('percy') && !env.toLowerCase().includes('token'));
    let envs = {};
    percyKeys.forEach((env) => { envs[env] = process.env[env]; });
    return envs;
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

   async getDiskSpaceInfo() {
    try {
      if (this.os === 'win32') {
        // For Windows, use wmic to get FreeSpace on the C: drive
        const { stdout } = await exec('wmic logicaldisk where "DeviceID=\'C:\'" get FreeSpace /value');
        const freeSpaceBytes = parseInt(stdout.trim().split('=')[1], 10);
        if (isNaN(freeSpaceBytes)) return 'N/A';
        return `${(freeSpaceBytes / (1024 ** 3)).toFixed(2)} gb`;
      } else {
        // For macOS and Linux, use 'df' to get available space on the root partition
        const { stdout } = await exec('df -k /');
        const lines = stdout.trim().split('\n');
        const availableKB = parseInt(lines[1].split(/\s+/)[3], 10);
        if (isNaN(availableKB)) return 'N/A';
        return `${(availableKB / (1024 ** 2)).toFixed(2)} gb`;
      }
    } catch (error) {
      this.log.debug(`Could not retrieve disk space info: ${error}`);
      return 'N/A';
    }
  }

  async logSystemInfo() {
    try {
      const cpu = await getClientCPUDetails();
      const mem = await getClientMemoryDetails();
      const percyEnvs = this.getPercyEnv();
      const cpuName = os.cpus()[0]?.model.trim() || 'N/A';
      const diskSpace = await this.getDiskSpaceInfo();


      this.log.debug(`[Operating System] Platform: ${this.os}, Type: ${os.type()}, Release: ${os.release()}`);
      this.log.debug(`[CPU] Name: ${cpuName}, Arch: ${cpu.arch}, Cores: ${cpu.cores}`);
      this.log.debug(`[CPU] Arch: ${cpu.arch}, cores: ${cpu.cores}`);
      this.log.debug(`[Disk] Available Space: ${diskSpace}`);
      this.log.debug(`[Memory] Total: ${mem.total / (1024 ** 3)} gb, Swap Space: ${mem.swaptotal / (1024 ** 3)} gb`);
      this.log.debug(`Container Level: ${this.isContainer}, Pod Level: ${this.isPod}, Machine Level: ${this.isMachine}`);
      this.log.debug(`Percy Envs: ${JSON.stringify(percyEnvs)}`);
    } catch (error) {
      // suppress error
      this.log.debug(`Error logging system info: ${error}`);
    }
  }

  /**
   * It will start monitoring at certain interval
   * by default every 5 seconds
   */
  async startMonitoring(options = {}) {
    const { interval = 5000 } = options;
    // early return if already monitoring
    if (this.monitoringId) return;

    await this.executeMonitoring();
    this.monitoringId = setInterval(() => {
      this.executeMonitoring();
    }, interval);
    this.log.debug('Started monitoring system metrics');
  }

  async executeMonitoring() {
    this.running = true;
    await this.monitoringCPUUsage();
    await this.monitorMemoryUsage();
    this.lastExecutedAt = Date.now();
  }

  stopMonitoring() {
    if (this.monitoringId) {
      clearInterval(this.monitoringId);
      this.monitoringId = null;
      this.cpuInfo = {};
      this.memoryUsageInfo = {};
      this.running = false;
      this.lastExecutedAt = null;
      this.log.debug('Stopped monitoring system metrics');
    }
  }

  async monitoringCPUUsage() {
    const cpuInfo = await getCPUUsageInfo(this.os, { containerLevel: this.isContainer, machineLevel: this.isMachine });
    this.cpuInfo = cpuInfo;
    this.log.debug(`cpuInfo: ${JSON.stringify(cpuInfo)}`);
  }

  async monitorMemoryUsage() {
    const memoryInfo = await getMemoryUsageInfo(this.os, { containerLevel: this.isContainer, machineLevel: this.isMachine });
    this.memoryUsageInfo = memoryInfo;
    this.log.debug(`memoryInfo: ${JSON.stringify(memoryInfo)}`);
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
