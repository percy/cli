import { getDiskSpaceInfo } from '../src/disk.js';

describe('getDiskSpaceInfo', () => {
  let exec;

  it('returns available disk space for win32', async () => {
    exec = jasmine.createSpy('exec').and.resolveTo({ stdout: 'FreeSpace=1234567890' });
    const diskSpace = await getDiskSpaceInfo('win32', exec);
    expect(diskSpace).toBe('1.15 gb');
  });

  it('returns available disk space for linux', async () => {
    const mockStdout = 'Filesystem     1K-blocks      Used Available Use% Mounted on\n' +
                       '/dev/sda1      999999999 888888888 1234567890  10% /';
    exec = jasmine.createSpy('exec').and.resolveTo({ stdout: mockStdout });
    const diskSpace = await getDiskSpaceInfo('linux', exec);
    expect(diskSpace).toBe('1177.38 gb');
  });

  it('returns available disk space for darwin', async () => {
    const mockStdout = 'Filesystem     1K-blocks      Used Available Use% Mounted on\n' +
                       '/dev/disk1s1   999999999 888888888 1234567890  10% /';
    exec = jasmine.createSpy('exec').and.resolveTo({ stdout: mockStdout });
    const diskSpace = await getDiskSpaceInfo('darwin', exec);
    expect(diskSpace).toBe('1177.38 gb');
  });

  it('returns "N/A" when command fails', async () => {
    exec = jasmine.createSpy('exec').and.rejectWith(new Error('Command failed'));
    const diskSpace = await getDiskSpaceInfo('win32', exec);
    expect(diskSpace).toBe('N/A');
  });

  it('returns "N/A" when output is not a number for win32', async () => {
    exec = jasmine.createSpy('exec').and.resolveTo({ stdout: 'FreeSpace=not-a-number' });
    const diskSpace = await getDiskSpaceInfo('win32', exec);
    expect(diskSpace).toBe('N/A');
  });

  it('returns "N/A" when available space is not a valid number on Linux', async () => {
    // This test ensures the isNaN() check on line 12 is covered.
    const mockStdout = 'Filesystem     1K-blocks      Used Available Use% Mounted on\n' +
                       '/dev/sda1      999999999 888888888 not-a-number  10% /';
    exec = jasmine.createSpy('exec').and.resolveTo({ stdout: mockStdout });
    const diskSpace = await getDiskSpaceInfo('linux', exec);
    expect(diskSpace).toBe('N/A');
  });
});