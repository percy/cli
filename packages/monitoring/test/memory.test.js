import { promises as fs } from 'fs';
import si from 'systeminformation';

import { getMemoryUsageInfo, getClientMemoryDetails } from '../src/memory.js';

describe('getMemoryUsageInfo: Linux', () => {
  let platform = 'linux';
  let mockMemoryResponse = {
    total: 17179869184,
    free: 86851584,
    used: 17093017600,
    active: 3721330688,
    available: 13458538496,
    buffers: 0,
    cached: 0,
    slab: 0,
    buffcache: 13371686912,
    swaptotal: 9663676416,
    swapused: 8656257024,
    swapfree: 1007419392,
    writeback: null,
    dirty: null
  };
  let mockFsAccess, mockFsRead, mockSi;

  describe('when c_group exists', () => {
    let memoryMax;
    let currentMemory = '2147483648';

    beforeEach(() => {
      mockFsAccess = spyOn(fs, 'access').and.callFake((path) => {
        if (path === '/sys/fs/cgroup/memory.max') {
          return Promise.resolve();
        }
        if (path === '/sys/fs/cgroup/memory.current') {
          return Promise.resolve();
        }
        return Promise.reject(new Error(`File not found: ${path}`));
      });

      mockFsRead = spyOn(fs, 'readFile').and.callFake((path) => {
        if (path === '/sys/fs/cgroup/memory.max') {
          return Promise.resolve(memoryMax);
        }
        if (path === '/sys/fs/cgroup/memory.current') {
          return Promise.resolve(currentMemory);
        }
        return Promise.reject(new Error(`File not readable: ${path}`)); // Default
      });

      mockSi = spyOn(si, 'mem').and.returnValue(mockMemoryResponse);
    });

    describe('with memory limit', () => {
      beforeEach(() => {
        memoryMax = '3221225472';
      });

      it('returns memory info from c group files', async () => {
        const memInfo = await getMemoryUsageInfo(platform);
        expect(memInfo).toEqual({
          totalMemory: 3221225472,
          currentUsagePercent: 66.66666666666666
        });
        expect(mockFsRead.calls.count()).toEqual(2);
        expect(mockFsAccess.calls.count()).toEqual(2);

        expect(mockSi.calls.count()).toEqual(1);
      });
    });

    describe('with no memory limit', () => {
      beforeAll(() => {
        memoryMax = 'max';
      });

      it('returns cpu info', async () => {
        const memInfo = await getMemoryUsageInfo(platform);
        expect(memInfo).toEqual({ totalMemory: 17179869184, currentUsagePercent: 12.5 });
        expect(mockFsRead.calls.count()).toEqual(2);
        expect(mockFsAccess.calls.count()).toEqual(2);
        expect(mockSi.calls.count()).toEqual(1);
      });
    });

    describe('throws unexpected error', () => {
      beforeEach(() => {
        mockFsRead = spyOn(fs, 'readFile').and.callFake((path) => {
          if (path === '/sys/fs/cgroup/memory.max') {
            return Promise.resolve(memoryMax); // Mocked cpu.max content
          }

          if (path === '/sys/fs/cgroup/memory.current') {
            return Promise.reject(new Error(`Unexpected Error reading file: ${path}`));
          }
          return Promise.reject(new Error(`File not readable: ${path}`)); // Default
        });
      });

      it('uses fallback method and returns memory info', async () => {
        const memInfo = await getMemoryUsageInfo(platform);
        expect(memInfo).toEqual({ currentUsagePercent: 21.660995483398438, totalMemory: 17179869184 });
        expect(mockSi.calls.count()).toEqual(2);
      });
    });
  });

  describe("when cgroup doesn't exists", () => {
    beforeEach(() => {
      mockFsAccess = spyOn(fs, 'access').and.rejectWith(new Error('No file exists'));
      mockFsRead = spyOn(fs, 'readFile').and.rejectWith(new Error('File not readable'));
      mockSi = spyOn(si, 'mem').and.returnValue(mockMemoryResponse);
    });

    it('returns system memory info', async () => {
      const memInfo = await getMemoryUsageInfo(platform);
      expect(memInfo).toEqual({ currentUsagePercent: 21.660995483398438, totalMemory: 17179869184 });

      // 1 times by getMemoryUsage
      expect(mockSi.calls.count()).toEqual(1);
    });

    describe('throws unexpected error', () => {
      beforeEach(() => {
        mockSi = spyOn(si, 'mem').and.rejectWith(new Error('unexpected Error'));
      });

      it('return empty object', async () => {
        const memInfo = await getMemoryUsageInfo(platform);
        expect(memInfo).toEqual({});
      });
    });
  });
});

describe('getMemoryUsageInfo: OtherOS', () => {
  let platform = 'win32';
  let mockFsAccess, mockFsRead, mockSi;
  let mockMemoryResponse = {
    total: 17179869184,
    free: 86851584,
    used: 17093017600,
    active: 3721330688,
    available: 13458538496,
    buffers: 0,
    cached: 0,
    slab: 0,
    buffcache: 13371686912,
    swaptotal: 9663676416,
    swapused: 8656257024,
    swapfree: 1007419392,
    writeback: null,
    dirty: null
  };

  beforeEach(() => {
    mockFsAccess = spyOn(fs, 'access').and.rejectWith(new Error('No file exists'));
    mockFsRead = spyOn(fs, 'readFile').and.rejectWith(new Error('File not readable'));
    mockSi = spyOn(si, 'mem').and.returnValue(mockMemoryResponse);
  });

  it('returns memory usage info of system level', async () => {
    const memInfo = await getMemoryUsageInfo(platform);

    // checking only types, as values can differ as we are
    // not mocking os.cpus on every call to give different values
    expect(memInfo).toEqual({ currentUsagePercent: 21.660995483398438, totalMemory: 17179869184 });

    expect(mockFsAccess.calls.count()).toEqual(0);
    expect(mockFsRead.calls.count()).toEqual(0);

    // 1 times by getMemoryUsage func
    expect(mockSi.calls.count()).toEqual(1);
  });
});

describe('getClientMemoryDetails', () => {
  let memoryMax = '3221225472'; // from cgroup memory.max
  let mockMemoryResponse = {
    total: 17179869184,
    free: 86851584,
    used: 17093017600,
    active: 3721330688,
    available: 13458538496,
    buffers: 0,
    cached: 0,
    slab: 0,
    buffcache: 13371686912,
    swaptotal: 9663676416,
    swapused: 8656257024,
    swapfree: 1007419392,
    writeback: null,
    dirty: null
  };

  beforeEach(() => {
    spyOn(si, 'mem').and.returnValue(mockMemoryResponse);
  });

  describe('when cgroup exists', () => {
    beforeEach(() => {
      spyOn(fs, 'readFile').and.callFake((path) => {
        if (path === '/sys/fs/cgroup/memory.max') {
          return Promise.resolve(memoryMax);
        }
        return Promise.reject(new Error('some_error'));
      });
    });

    it('returns total and swaptotal memory', async () => {
      const memInfo = await getClientMemoryDetails();
      expect(memInfo).toEqual({ swaptotal: 9663676416, total: 3221225472 });
    });
  });

  describe('when cgroup does not exists', () => {
    beforeEach(() => {
      spyOn(fs, 'readFile').and.rejectWith(new Error('file not exists'));
    });

    it('returns total and swaptotal memory', async () => {
      expect(await getClientMemoryDetails()).toEqual({
        swaptotal: 9663676416,
        total: 17179869184
      });
    });
  });
});
