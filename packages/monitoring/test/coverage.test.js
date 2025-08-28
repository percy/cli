import { getDiskSpaceInfo } from '../src/disk.js';
import Monitoring from '../src/index.js';
import os from 'os';
import logger from '@percy/logger/test/helpers';

describe('Coverage Fixes', () => {
  describe('getDiskSpaceInfo', () => {
    let exec;

    it('returns "N/A" when output is not a number for darwin', async () => {
      // This test covers the isNaN check in disk.js for non-windows platforms.
      exec = jasmine.createSpy('exec').and.resolveTo({ stdout: 'Filesystem     1K-blocks      Used Available Use% Mounted on\n/dev/disk1s1   1234567890 123456789 not-a-number  10% /' });
      const diskSpace = await getDiskSpaceInfo('darwin', exec);
      expect(diskSpace).toBe('N/A');
    });
  });

  describe('Monitoring.logSystemInfo', () => {
    let monitoring;

    beforeEach(async () => {
      monitoring = new Monitoring();
      logger.loglevel('debug');
      process.env.PERCY_LOGLEVEL = 'debug';
      await logger.mock({ isTTY: true, level: 'debug' });
      // Mock dependencies to isolate the test
      spyOn(os, 'type').and.returnValue('test_type');
      spyOn(os, 'release').and.returnValue('test_release');
      spyOn(os, 'arch').and.returnValue('test_arch');
    });
    
    afterEach(() => {
        delete process.env.PERCY_LOGLEVEL;
    });

    it('logs "N/A" for CPU name when it cannot be determined', async () => {
      // This test covers the '|| "N/A"' fallback in index.js for the CPU name.
      spyOn(os, 'cpus').and.returnValue([]); // Return an empty array
      
      // Mock other async functions called within logSystemInfo
      const getClientCPUDetailsMock = jasmine.createSpy('getClientCPUDetails').and.resolveTo({ arch: 'test_arch', cores: 4 });
      const getClientMemoryDetailsMock = jasmine.createSpy('getClientMemoryDetails').and.resolveTo({ total: 0, swaptotal: 0 });
      const getDiskSpaceInfoMock = jasmine.createSpy('getDiskSpaceInfo').and.resolveTo('100 gb');

      await monitoring.logSystemInfo({
          getClientCPUDetails: getClientCPUDetailsMock,
          getDiskSpaceInfo: getDiskSpaceInfoMock,
          // getClientMemoryDetails is not a param but we mock it via si.mem if needed
      });

      expect(logger.stderr).toEqual(
        jasmine.arrayContaining([
          '[percy:monitoring] [CPU] Name: N/A, Arch: test_arch, Cores: 4'
        ])
      );
    });
  });
});