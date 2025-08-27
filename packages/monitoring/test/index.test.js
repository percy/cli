import Monitoring from '../src/index.js';
import si from 'systeminformation';
import os from 'os';
import logger from '@percy/logger/test/helpers';
import { promises as fs } from 'fs';
import * as cpu from '../src/cpu.js';


describe('Monitoring', () => {
  let monitoring, mockExecuteMonitoring;
  let platform = 'test_platform';

  beforeEach(async () => {
    spyOn(os, 'platform').and.returnValue(platform);
    monitoring = new Monitoring();
    logger.loglevel('debug');
    process.env.PERCY_LOGLEVEL = 'debug';
    await logger.mock({ isTTY: true, level: 'debug' });
  });

  afterEach(() => {
    delete process.env.PERCY_LOGLEVEL;
  });

  describe('startMonitoring', () => {
    beforeEach(() => {
      jasmine.clock().install();
      mockExecuteMonitoring = spyOn(monitoring, 'executeMonitoring').and.returnValue(Promise.resolve());
    });

    afterEach(() => {
      jasmine.clock().uninstall();
    });

    it('calls executeMonitoring after some interval', async () => {
      await monitoring.startMonitoring();
      expect(mockExecuteMonitoring.calls.count()).toEqual(1);
      jasmine.clock().tick(5002);
      expect(mockExecuteMonitoring.calls.count()).toEqual(2);
      expect(logger.stderr).toEqual(
        jasmine.arrayContaining([
          '[percy:monitoring] Started monitoring system metrics'
        ])
      );
    });

    it('early returns if monitoring is already active', async () => {
      await monitoring.startMonitoring();
      expect(mockExecuteMonitoring.calls.count()).toEqual(1);
      jasmine.clock().tick(1000);
      await monitoring.startMonitoring();
      expect(mockExecuteMonitoring.calls.count()).toEqual(1);
    });
  });

  describe('getPercyEnv', () => {
    beforeEach(() => {
      process.env.PERCY_SKIP_UPDATE_CHECK = 'false';
      process.env.PERCY_TOKEN = '<web-token>';
      process.env.MY_RUBY_HOME = 'test_path';
    });

    afterEach(() => {
      delete process.env.PERCY_SKIP_UPDATE_CHECK;
      delete process.env.PERCY_TOKEN;
      delete process.env.MY_RUBY_HOME;
    });

    it('return percy envs keys', async () => {
      const keys = monitoring.getPercyEnv();
      expect(keys.PERCY_SKIP_UPDATE_CHECK).toEqual('false');
      expect(keys.PERCY_TOKEN).toEqual(undefined);
      expect(keys.MY_RUBY_HOME).toEqual(undefined);
    });
  });

  describe('logSystemInfo', () => {
    beforeEach(() => {
      spyOn(fs, 'readFile').and.rejectWith(new Error('File not exists'));
      spyOn(si, 'mem').and.returnValue(Promise.resolve({ total: 10344343324, swaptotal: 245343444244 }));
      spyOn(os, 'arch').and.returnValue('test_arch');
      spyOn(os, 'type').and.returnValue('test_type');
      spyOn(os, 'release').and.returnValue('test_release');
      spyOn(si, 'cpu').and.returnValue(Promise.resolve({ cores: 3 }));
      spyOn(os, 'cpus').and.returnValue([{ model: 'Test CPU Model' }]);
    });

    it('logs os, cpu, memory info', async () => {
      const getDiskSpaceInfoMock = jasmine.createSpy('getDiskSpaceInfo').and.returnValue(Promise.resolve('123.45 gb'));
      await monitoring.logSystemInfo({ getDiskSpaceInfo: getDiskSpaceInfoMock });
      expect(logger.stderr).toEqual(jasmine.arrayContaining([
        '[percy:monitoring] [Operating System] Platform: test_platform, Type: test_type, Release: test_release',
        '[percy:monitoring] [CPU] Name: Test CPU Model, Arch: test_arch, Cores: 3',
        '[percy:monitoring] [Disk] Available Space: 123.45 gb',
        '[percy:monitoring] [Memory] Total: 9.633920457214117 gb, Swap Space: 228.49388815835118 gb',
        '[percy:monitoring] Container Level: false, Pod Level: false, Machine Level: true'
      ]));
    });

    it('logs error when unexpected error occurred', async () => {
      spyOn(os, 'arch').and.throwError('err');
      await monitoring.logSystemInfo();
      expect(logger.stderr).toEqual(jasmine.arrayContaining([
        '[percy:monitoring] Error logging system info: Error: err'
      ]));
    });

    it('logs error when getClientCPUDetails fails', async () => {
      const getClientCPUDetailsMock = jasmine.createSpy('getClientCPUDetails').and.throwError('Test Error');
      await monitoring.logSystemInfo({ getClientCPUDetails: getClientCPUDetailsMock });
      expect(logger.stderr).toEqual(jasmine.arrayContaining([
        '[percy:monitoring] Error logging system info: Error: Test Error'
      ]));
    });
  });

  describe('executeMonitoring', () => {
    let mockCpuUsage, mockMemUsage;

    beforeEach(() => {
      mockCpuUsage = spyOn(monitoring, 'monitoringCPUUsage').and.returnValue(Promise.resolve());
      mockMemUsage = spyOn(monitoring, 'monitorMemoryUsage').and.returnValue(Promise.resolve());
    });
    it('calls monitoringCPUUsage and monitoringMemoryUsage and update lastExecutedAt', async () => {
      monitoring.lastExecutedAt = null;
      monitoring.running = false;
      await monitoring.executeMonitoring();

      expect(monitoring.running).toEqual(true);
      expect(mockMemUsage).toHaveBeenCalledTimes(1);
      expect(mockCpuUsage).toHaveBeenCalledTimes(1);
      expect(monitoring.lastExecutedAt).not.toEqual(null);
    });
  });

  describe('monitoringCPUUsage', () => {
    it('updates cpu info details', async () => {
      monitoring.cpuInfo = null;
      await monitoring.monitoringCPUUsage('win32');
      expect(monitoring.cpuInfo).not.toEqual(null);
      expect(monitoring.cpuInfo.currentUsagePercent).not.toEqual(null);
    });
  });

  describe('monitoringMemoryUsage', () => {
    it('updates memory usage details', async () => {
      monitoring.memoryUsageInfo = null;
      await monitoring.monitorMemoryUsage('win32');
      expect(monitoring.memoryUsageInfo).not.toEqual(null);

      // not mocking os and si module, therefore only checking if values
      // are getting updated or not
      expect(monitoring.memoryUsageInfo.currentUsagePercent).not.toEqual(null);
    });
  });

  describe('getMonitoringInfo', () => {
    let mockCpuUsage = { currentUsagePercent: 3.4, cores: 4 };
    let mockMemoryUsage = { currentUsagePercent: 12.3, totalMemory: 122 };
    it('returns current cpu and memory usage %', async () => {
      monitoring.cpuInfo = mockCpuUsage;
      monitoring.memoryUsageInfo = mockMemoryUsage;
      expect(monitoring.getMonitoringInfo()).toEqual({
        cpuInfo: mockCpuUsage,
        memoryUsageInfo: mockMemoryUsage
      });
    });
  });

  describe('stopMonitoring', () => {
    let mockClearInterval;
    beforeEach(() => {
      mockClearInterval = spyOn(global, 'clearInterval').and.returnValue(Promise.resolve());
    });

    it('clear setInterval and reset all monitoring values', async () => {
      await monitoring.startMonitoring();
      expect(monitoring.running).toEqual(true);
      expect(monitoring.lastExecutedAt).not.toEqual(null);
      expect(monitoring.cpuInfo).not.toEqual({});
      expect(monitoring.monitoringId).not.toEqual(null);

      monitoring.stopMonitoring();

      expect(monitoring.running).toEqual(false);
      expect(monitoring.lastExecutedAt).toEqual(null);
      expect(monitoring.cpuInfo).toEqual({});
      expect(monitoring.monitoringId).toEqual(null);
    });

    it('does nothing when no monitoring is enabled', async () => {
      await monitoring.startMonitoring();
      monitoring.stopMonitoring();
      expect(mockClearInterval).toHaveBeenCalledTimes(1);

      mockClearInterval.calls.reset();
      monitoring.stopMonitoring();
      expect(mockClearInterval).not.toHaveBeenCalled();
    });
  });
});
