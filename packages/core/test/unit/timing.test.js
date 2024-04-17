import TimeIt from '../../src/timing.js';
import { logger as mockLogger, setupTest } from '@percy/cli-command/test/helpers';
import logger from '@percy/logger';

describe('TimeIt', () => {
  beforeEach(async () => {
    await setupTest();
  });

  afterEach(() => {
  });

  it('should return same instance everytime', () => {
    const obj1 = new TimeIt();
    const obj2 = new TimeIt();
    expect(obj1).toEqual(obj2);
  });

  describe('measure', () => {
    it('should execute callback and log duration', async () => {
      const log = logger('test');
      const date1 = new Date(2024, 4, 11, 13, 30, 0);
      const date2 = new Date(2024, 4, 11, 13, 31, 0);
      // Logger internall calls Date.now, so need to mock
      // response for it as well.
      spyOn(Date, 'now').and.returnValues(date1, date1, date2, date1);
      const timeit = new TimeIt();
      const callback = async () => { log.info('abcd'); };
      await timeit.measure('step', 'test', callback);
      expect(mockLogger.stdout).toEqual([
        '[percy] abcd',
        '[percy] step - test - 60s'
      ]);
    });
  });
});
