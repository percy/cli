import { getDiskSpaceInfo } from '../src/disk.js';
import { exec as callbackExec } from 'child_process'; // Import the original exec

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
    const mockStdout = 'Filesystem     1K-blocks      Used Available Use% Mounted on\n' +
                       '/dev/sda1      999999999 888888888 not-a-number  10% /';
    exec = jasmine.createSpy('exec').and.resolveTo({ stdout: mockStdout });
    const diskSpace = await getDiskSpaceInfo('linux', exec);
    expect(diskSpace).toBe('N/A');
  });

  // This new test covers the default parameter branch
  it('uses the default exec when no exec function is provided', async () => {
    // Spy on the original exec from child_process to prevent a real system call
    spyOn(callbackExec, 'call').and.callFake((...args) => {
        const callback = args[args.length - 1];
        const mockStdout = 'Filesystem     1K-blocks      Used Available Use% Mounted on\n' +
                           '/dev/sda1      999999999 888888888 1234567890  10% /';
        // Simulate a successful command execution
        callback(null, { stdout: mockStdout });
    });

    // Call the function WITHOUT the second argument to test the default path
    const diskSpace = await getDiskSpaceInfo('linux');

    // Assert that the function still works as expected
    expect(diskSpace).toBe('1177.38 gb');
  });
});