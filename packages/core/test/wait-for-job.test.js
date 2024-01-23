import logger from '@percy/logger/test/helpers';
import PercyClient from '@percy/client';
import { JobData, WaitForJob } from '../src/wait-for-job.js';

describe('WaitForJob', () => {
  let client;
  let getStatusMock;
  let waitForSnapshot;
  let snapshot, mockResolve, mockReject;

  beforeEach(async () => {
    await logger.mock({ level: 'debug' });

    client = new PercyClient({
      token: 'PERCY_TOKEN'
    });
    getStatusMock = spyOn(client, 'getStatus');
    waitForSnapshot = new WaitForJob('snapshot', { client });
    mockResolve = jasmine.createSpy('resolve');
    mockReject = jasmine.createSpy('reject');
    snapshot = new JobData(1, null, mockResolve, mockReject);
    jasmine.clock().install();
  });

  afterEach(() => {
    // Reset snapshots array
    jasmine.clock().uninstall();
  });

  it('throws when intialized with invalid type', () => {
    expect(() => new WaitForJob('dummy', { client: client }))
      .toThrowError('Type should be either comparison or snapshot');
  });

  it('throws when snapshotData is not used', () => {
    expect(() => waitForSnapshot.push('dummy'))
      .toThrowError('Invalid job passed, use JobData');
  });

  it('adding first snapshot should trigger run', async () => {
    waitForSnapshot.push(snapshot);
    expect(waitForSnapshot.running).toBeTruthy();
    expect(logger.stderr).toEqual(jasmine.arrayContaining(['[percy:core:wait-for-job] Polling for snapshot status in 5000ms']));
    expect(waitForSnapshot.timer).not.toEqual(null);
  });

  it('should run only after min polling interval', async () => {
    waitForSnapshot.run(100);
    expect(waitForSnapshot.running).toBeTrue();
    await jasmine.clock().tick(100);
    expect(getStatusMock).not.toHaveBeenCalled();
    await jasmine.clock().tick(5000);
    expect(getStatusMock).toHaveBeenCalledOnceWith(waitForSnapshot.type, []);
    // it should stop after first run since snapshots is empty
    expect(waitForSnapshot.running).toEqual(false);
  });

  it('should reject snapshot with error', async () => {
    getStatusMock.and.returnValue({ 1: { status: false, error: 'some dummy error' } });
    waitForSnapshot.push(snapshot);
    await jasmine.clock().tick(5000);
    expect(getStatusMock).toHaveBeenCalled();
    expect(mockReject).toHaveBeenCalledOnceWith('some dummy error');
    expect(mockResolve).not.toHaveBeenCalled();
    expect(waitForSnapshot.jobs).toEqual([]);
  });

  it('should resolve snapshot', async () => {
    getStatusMock.and.returnValue({ 1: { status: true, error: null } });
    waitForSnapshot.push(snapshot);
    await jasmine.clock().tick(5000);
    expect(getStatusMock).toHaveBeenCalled();
    expect(mockReject).not.toHaveBeenCalled();
    expect(mockResolve).toHaveBeenCalledOnceWith(snapshot.id);
    expect(waitForSnapshot.jobs).toEqual([]);
  });

  it('should handle case when snapshot was pushed when run is in progress', async () => {
    const snapshot2 = new JobData(2, null, null, null);
    // This situation will happen when we made network call and in between a snapshot is pushed
    getStatusMock.and.returnValue({ 1: { status: true } });
    waitForSnapshot.push(snapshot);
    waitForSnapshot.push(snapshot2);
    await jasmine.clock().tick(5000);
    expect(waitForSnapshot.jobs).toEqual([snapshot2]);
  });

  it('should handle nextPoll time for multiple snapshots', async () => {
    const mockResolve2 = jasmine.createSpy('resolve');
    const snapshot2 = new JobData(2, null, mockResolve2, mockReject);
    getStatusMock.and.returnValue({ 1: { status: false, error: null, next_poll: 15 }, 2: { status: false, error: null, next_poll: 12 } });
    waitForSnapshot.push(snapshot);
    waitForSnapshot.push(snapshot2);
    await jasmine.clock().tick(5000);
    expect(getStatusMock).toHaveBeenCalled();
    expect(mockReject).not.toHaveBeenCalled();
    expect(mockResolve).not.toHaveBeenCalled();
    expect(waitForSnapshot.running).toBeTruthy();
    getStatusMock.and.returnValue({ 1: { status: true }, 2: { status: true } });
    await jasmine.clock().tick(15000);
    expect(logger.stderr).toEqual(jasmine.arrayContaining(['[percy:core:wait-for-job] Polling for snapshot status in 15000ms']));
    expect(waitForSnapshot.running).toBeFalse();
    expect(mockResolve2).toHaveBeenCalledOnceWith(snapshot2.id);
    expect(mockResolve).toHaveBeenCalledOnceWith(snapshot.id);
  });

  it('should handle nextPoll time for multiple snapshots if optimal time not in threshold', async () => {
    const mockResolve2 = jasmine.createSpy('resolve');
    const snapshot2 = new JobData(2, 15, mockResolve2, mockReject);
    getStatusMock.and.returnValue({ 1: { status: false, error: null, next_poll: 20 }, 2: { status: false, error: null, next_poll: 12 } });
    waitForSnapshot.push(snapshot);
    waitForSnapshot.push(snapshot2);
    await jasmine.clock().tick(5000);
    expect(getStatusMock).toHaveBeenCalled();
    expect(mockReject).not.toHaveBeenCalled();
    expect(mockResolve).not.toHaveBeenCalled();
    expect(waitForSnapshot.running).toBeTruthy();
    getStatusMock.and.returnValue({ 1: { status: false }, 2: { status: true } });
    await jasmine.clock().tick(12000);
    expect(logger.stderr).toEqual(jasmine.arrayContaining(['[percy:core:wait-for-job] Polling for snapshot status in 12000ms']));
    expect(mockResolve2).toHaveBeenCalledOnceWith(snapshot2.id);
    expect(mockResolve).not.toHaveBeenCalled();
  });

  it('should handle stop', () => {
    waitForSnapshot.stop();
    waitForSnapshot.run();
    expect(waitForSnapshot.exit).toEqual(true);
    expect(logger.stderr).toEqual([]);
  });

  it('should handle stop when run is in progress', async () => {
    waitForSnapshot.push(snapshot);
    waitForSnapshot.stop();
    expect(waitForSnapshot.timer).toEqual(null);
    await jasmine.clock().tick(5000);
    expect(getStatusMock).not.toHaveBeenCalled();
    expect(mockReject).toHaveBeenCalledOnceWith(new Error('Unable to process synchronous results as the CLI was exited while awaiting completion of the snapshot.'));
  });
});
