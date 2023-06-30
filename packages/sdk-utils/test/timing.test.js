import TimeIt from '../src/timing.js';

describe('TimeIt', () => {
  const store = 'store';

  const sleep = (t) => new Promise((resolve) => setTimeout(resolve, t));
  const func10 = () => sleep(10);
  const func100 = () => sleep(100);
  const func200 = () => sleep(200);

  const expectedVal = 1234;
  const funcReturns = () => sleep(100).then(() => expectedVal);
  const expectedError = new Error('expected');
  const funcThrows = () => sleep(100).then(() => { throw expectedError; });

  beforeAll(() => {
    TimeIt.enabled = true;
  });

  afterAll(() => {
    TimeIt.enabled = false;
  });

  beforeEach(async () => {
    TimeIt.reset();
  });

  describe('run', () => {
    describe('run when disabled', () => {
      const funFunc = { funcReturns };
      let funcReturnsSpy;
      TimeIt.enabled = false;

      beforeEach(() => {
        funcReturnsSpy = spyOn(funFunc, 'funcReturns');
      });

      afterEach(() => {
        TimeIt.reset();
      });

      it('returns the func which is passed', async () => {
        TimeIt.enabled = false;
        await TimeIt.run(store, funcReturnsSpy);
        expect(funcReturnsSpy).toHaveBeenCalledTimes(1);
        TimeIt.enabled = true;
      });
    });

    it('runs func and returns result', async () => {
      const val = await TimeIt.run(store, funcReturns);
      expect(val).toEqual(expectedVal);
    });

    it('runs func and throws inner exception', async () => {
      let actualError = null;
      try {
        await TimeIt.run(store, funcThrows);
      } catch (e) {
        actualError = e;
      }
      expect(actualError).toEqual(expectedError);
    });
  });

  describe('summary', () => {
    it('returns summary of calls', async () => {
      await TimeIt.run('funcReturns', funcReturns);
      await TimeIt.run('funcReturns', funcReturns);
      await TimeIt.run('funcReturns', funcReturns);

      await TimeIt.run('funcVariableTime', func10);
      await TimeIt.run('funcVariableTime', func100);
      await TimeIt.run('funcVariableTime', func200);

      const summary = TimeIt.summary({ includeVals: true });
      TimeIt.summary(); // also without vals
      expect(Object.keys(summary).length).toEqual(2);

      // funcReturns
      expect(summary.funcReturns.min - 100).toBeLessThan(15.0); // adding buffer for win test
      expect(summary.funcReturns.max - 100).toBeLessThan(15.0); // adding buffer for win test
      expect(summary.funcReturns.avg - 100).toBeLessThan(15.0); // adding buffer for win test
      expect(summary.funcReturns.vals.length).toEqual(3);

      // funcVariableTime
      expect(summary.funcVariableTime.min - 10).toBeLessThan(10.0);
      expect(summary.funcVariableTime.max - 200).toBeLessThan(10.0);
      expect(summary.funcVariableTime.avg - 103).toBeLessThan(10.0);
      expect(summary.funcVariableTime.vals.length).toEqual(3);
    });
  });
});
