import { exec } from 'child_process';
import { getDiskSpaceInfo } from '../src/disk.js';

jest.mock('child_process');
jest.mock('util', () => ({
  ...jest.requireActual('util'),
  promisify: jest.fn((fn) => fn),
}));

describe('getDiskSpaceInfo', () => {
  afterEach(() => {
    jest.resetAllMocks();
  });

  describe('on Windows', () => {
    const platform = 'win32';

    it('correctly calculates disk space from valid wmic output', async () => {
      const mockStdout = 'FreeSpace=214748364800'; // 200 GB in bytes
      exec.mockImplementation((command, callback) => {
        callback(null, { stdout: mockStdout });
      });

      const space = await getDiskSpaceInfo(platform);
      // Expect 214748364800 / (1024^3) = 200.00
      expect(space).toBe('200.00 gb');
      expect(exec).toHaveBeenCalledWith('wmic logicaldisk where "DeviceID=\'C:\'" get FreeSpace /value', jasmine.any(Function));
    });

    it('returns "N/A" if wmic output is malformed', async () => {
      exec.mockImplementation((command, callback) => {
        callback(null, { stdout: 'Some invalid string' });
      });
      const space = await getDiskSpaceInfo(platform);
      expect(space).toBe('N/A');
    });
  });

  describe('on Linux/macOS', () => {
    const platform = 'linux';

    it('correctly calculates disk space from valid df output', async () => {
      const mockStdout = 'Filesystem     1K-blocks     Used Available Use% Mounted on\n' +
                         '/dev/sda1      104857600 20971520  83886080  20% /'; // 83886080 KB available
      exec.mockImplementation((command, callback) => {
        callback(null, { stdout: mockStdout });
      });

      const space = await getDiskSpaceInfo(platform);
      // Expect 83886080 / (1024^2) = 80.00
      expect(space).toBe('80.00 gb');
      expect(exec).toHaveBeenCalledWith('df -k /', jasmine.any(Function));
    });

    it('returns "N/A" if df output is malformed', async () => {
      exec.mockImplementation((command, callback) => {
        callback(null, { stdout: 'Some invalid string' });
      });
      const space = await getDiskSpaceInfo(platform);
      expect(space).toBe('N/A');
    });
  });

  it('returns "N/A" if the underlying exec command fails', async () => {
    exec.mockImplementation((command, callback) => {
      callback(new Error('Execution failed'));
    });
    const space = await getDiskSpaceInfo('win32');
    expect(space).toBe('N/A');
  });
});
