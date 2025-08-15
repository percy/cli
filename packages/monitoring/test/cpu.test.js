import { promises as fs } from 'fs';
import os from 'os';
import si from 'systeminformation';

import { getCPUUsageInfo, getClientCPUDetails } from '../src/cpu.js';

describe('getCPUUsageInfo: Linux', () => {
  let platform = 'linux';
  let mockFsAccess, mockFsRead, mockOs, mockSi;

  describe('when c_group exists', () => {
    let cpuMax, cpuStatCount;

    // test_key is given for a coverage
    // condition either of key or value if not
    // present then don't consider it
    let cpuStatsBefore = `usage_usec 330229677740
                  user_usec 206352296619
                  system_usec 122171004028
                  nr_periods 0
                  test_key
                  nr_throttled 0
                  throttled_usec 0`;
    let cpuStatsAfter = `usage_usec 330229777740
                  user_usec 203352296619
                  system_usec 124171004028
                  nr_periods 0
                  nr_throttled 0
                  throttled_usec 0`;

    beforeEach(() => {
      cpuStatCount = 0;
      mockFsAccess = spyOn(fs, 'access').and.callFake((path) => {
        if (path === '/sys/fs/cgroup/cpu.max') {
          return Promise.resolve();
        }
        if (path === '/sys/fs/cgroup/cpu.stat') {
          return Promise.resolve();
        }
        return Promise.reject(new Error(`File not found: ${path}`));
      });

      mockFsRead = spyOn(fs, 'readFile').and.callFake((path) => {
        if (path === '/sys/fs/cgroup/cpu.max') {
          return Promise.resolve(cpuMax);
        }
        if (path === '/sys/fs/cgroup/cpu.stat') {
          let res = (cpuStatCount === 0) ? cpuStatsBefore : cpuStatsAfter;
          cpuStatCount++;
          return Promise.resolve(res);
        }
        return Promise.reject(new Error(`File not readable: ${path}`));
      });

      mockOs = spyOn(os, 'cpus').and.callThrough();
      // Note: si module internally calls os.cpus if not mocked
      mockSi = spyOn(si, 'cpu').and.returnValue({ cores: 8 });
    });

    describe('with cpu limit', () => {
      beforeEach(() => {
        cpuMax = '3500000 1000000';
      });

      it('returns cpu info from c group files', async () => {
        const cpuInfo = await getCPUUsageInfo(platform);
        expect(cpuInfo).toEqual({
          cores: 3.5,
          currentUsagePercent: 2.857142857142857,
          cgroupExists: true
        });
        expect(mockFsRead.calls.count()).toEqual(3);
        expect(mockFsAccess.calls.count()).toEqual(2);

        // si module internal calls os module once
        // if not mocked
        expect(mockOs.calls.count()).toEqual(0);
        expect(mockSi.calls.count()).toEqual(1);
      });
    });

    describe('with no cpu limit', () => {
      beforeAll(() => {
        cpuMax = 'max';
      });

      beforeEach(() => {
        mockSi = spyOn(si, 'cpu').and.callFake(() => {
          return Promise.resolve({ cores: 4 });
        });
      });

      it('returns cpu info', async () => {
        const cpuInfo = await getCPUUsageInfo(platform);
        expect(cpuInfo).toEqual({ cores: 4, currentUsagePercent: 2.5, cgroupExists: true });
        expect(mockFsRead.calls.count()).toEqual(3);
        expect(mockFsAccess.calls.count()).toEqual(2);
        expect(mockSi.calls.count()).toEqual(1);
      });
    });

    describe('throws unexpected error', () => {
      beforeEach(() => {
        mockFsRead = spyOn(fs, 'readFile').and.callFake((path) => {
          if (path === '/sys/fs/cgroup/cpu.max') {
            return Promise.resolve(undefined);
          }

          if (path === '/sys/fs/cgroup/cpu.stat') {
            return Promise.reject(new Error(`Unexpected Error reading file: ${path}`));
          }
          return Promise.reject(new Error(`File not readable: ${path}`)); // Default
        });

        mockSi = spyOn(si, 'cpu').and.callFake(() => {
          return Promise.resolve({ cores: 5 });
        });
      });

      it('uses fallback method and returns cpu info', async () => {
        const cpuInfo = await getCPUUsageInfo(platform);
        expect(cpuInfo.cores).toEqual(5);
        expect(mockSi.calls.count()).toEqual(2);

        // since we mocked si.cpu, therefore os is called
        // 2 times only, otherwise it would have been called
        // 4 times ( 2 times from si + 2 times from computeCpuUsageStats)
        expect(mockOs.calls.count()).toEqual(2);
      });
    });
  });

  describe("when cgroup doesn't exists", () => {
    beforeEach(() => {
      mockFsAccess = spyOn(fs, 'access').and.rejectWith(new Error('No file exists'));
      mockFsRead = spyOn(fs, 'readFile').and.rejectWith(new Error('File not readable'));
      mockOs = spyOn(os, 'cpus').and.callThrough();
      mockSi = spyOn(si, 'cpu').and.returnValue({ cores: 8 });
    });

    it('returns system cpu info', async () => {
      const cpuInfo = await getCPUUsageInfo(platform);

      // checking only types, as values can differ as we are
      // not mocking os.cpus on every call to give different values
      expect(typeof cpuInfo.currentUsagePercent).toEqual('number');
      expect(typeof cpuInfo.cores).toEqual('number');
      expect(typeof cpuInfo.cgroupExists).toEqual('boolean');
      expect(Object.keys(cpuInfo).length).toEqual(3);

      // 2 times by computeCpuUsage func
      expect(mockOs.calls.count()).toEqual(2);
      expect(mockSi.calls.count()).toEqual(1);
    });

    describe('throws unexpected error', () => {
      beforeEach(() => {
        mockSi = spyOn(si, 'cpu').and.rejectWith(new Error('unexpected Error'));
      });

      it('return empty object', async () => {
        const cpuInfo = await getCPUUsageInfo(platform);
        expect(cpuInfo).toEqual({});
      });
    });
  });
});

describe('getCPUUsageInfo: OtherOS', () => {
  let platform = 'win32';
  let mockFsAccess, mockFsRead, mockOs, mockSi;

  beforeEach(() => {
    mockFsAccess = spyOn(fs, 'access').and.rejectWith(new Error('No file exists'));
    mockFsRead = spyOn(fs, 'readFile').and.rejectWith(new Error('File not readable'));
    mockOs = spyOn(os, 'cpus').and.callThrough();
    mockSi = spyOn(si, 'cpu').and.returnValue({ cores: 5 });
  });

  it('returns cpu usage info of system level', async () => {
    const cpuInfo = await getCPUUsageInfo(platform);

    // checking only types, as values can differ as we are
    // not mocking os.cpus on every call to give different values
    expect(cpuInfo.cores).toEqual(5);
    expect(typeof cpuInfo.currentUsagePercent).toEqual('number');
    expect(typeof cpuInfo.cores).toEqual('number');
    expect(typeof cpuInfo.cgroupExists).toEqual('boolean');
    expect(Object.keys(cpuInfo).length).toEqual(3);

    expect(mockFsAccess.calls.count()).toEqual(0);

    // called 1 time, when getting total cores
    expect(mockFsRead.calls.count()).toEqual(1);

    // 2 times by computeCpuUsage func
    expect(mockOs.calls.count()).toEqual(2);
    expect(mockSi.calls.count()).toEqual(1);
  });

  describe('when cpu usage do not changed', () => {
    let mockOsCpuRespnose = [
      {
        model: 'test',
        speed: 2400,
        times: { user: 2404800, nice: 0, sys: 228740, idle: 15161730, irq: 0 }
      },
      {
        model: 'test',
        speed: 2400,
        times: { user: 1674570, nice: 0, sys: 173760, idle: 15951820, irq: 0 }
      }
    ];

    beforeEach(() => {
      spyOn(os, 'cpus').and.returnValue(mockOsCpuRespnose);
    });

    it('return cpu usage as 0%', async () => {
      const cpuInfo = await getCPUUsageInfo(platform);
      expect(cpuInfo).toEqual({
        cores: 5,
        currentUsagePercent: 0,
        cgroupExists: false
      });
    });
  });
});

describe('getClientCPUDetails', () => {
  let cpuMax = '5500000 1000000';

  describe('when cgroup exists', () => {
    beforeEach(() => {
      spyOn(fs, 'readFile').and.callFake((path) => {
        if (path === '/sys/fs/cgroup/cpu.max') {
          return Promise.resolve(cpuMax);
        }
        return Promise.reject(new Error('some_error'));
      });
      spyOn(si, 'cpu').and.returnValue({ cores: 5 });
      spyOn(os, 'arch').and.returnValue('amd64');
    });

    it('returns os and arch details', async () => {
      const clientCpuInfo = await getClientCPUDetails();
      expect(clientCpuInfo).toEqual({ arch: 'amd64', cores: 5.5 });
    });
  });

  describe('when cgroup does not exists', () => {
    beforeEach(() => {
      spyOn(fs, 'readFile').and.rejectWith(new Error('file not exists'));
      spyOn(si, 'cpu').and.returnValue({ cores: 6.7 });
      spyOn(os, 'arch').and.returnValue('amd64');
    });

    it('returns os and arch details', async () => {
      expect(await getClientCPUDetails()).toEqual({
        arch: 'amd64',
        cores: 6.7
      });
    });
  });
});
