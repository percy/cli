import Driver from '../src/driver.js';
import utils from '@percy/sdk-utils';

describe('Driver', () => {
  let requestSpy;
  let mockResponseObject = {
    body: '{"value": "mockVal"}',
    status: 200,
    headers: { 'content-type': 'application/text' }
  };
  let sessionId = '123';
  let executorUrl = 'http://localhost/wd/hub';
  let driver;

  beforeEach(() => {
    requestSpy = spyOn(utils.request, 'fetch').and.returnValue(
      Promise.resolve(mockResponseObject)
    );
    driver = new Driver(sessionId, executorUrl);
  });

  describe('constructor', () => {
    it('sanitizes embedded url', () => {
      let newDriver = new Driver('123', 'https://test:123@localhost/wd/hub');
      expect(newDriver.executorUrl).toBe('https://localhost/wd/hub');
    });
  });

  describe('getCapabilities', () => {
    it('calls requests', async () => {
      let res = await driver.getCapabilites();
      expect(requestSpy).toHaveBeenCalledOnceWith(`${executorUrl}/session/${sessionId}`, Object({}));
      expect(res).toBe('mockVal');
    });
  });

  describe('getWindowsize', () => {
    it('calls requests', async () => {
      let res = await driver.getWindowSize();
      expect(requestSpy).toHaveBeenCalledOnceWith(
        `${executorUrl}/session/${sessionId}/window/current/size`,
        Object({}));
      expect(res).toEqual({ value: 'mockVal' });
    });
  });

  describe('executeScript', () => {
    it('calls requests', async () => {
      let command = { script: 'abc', args: [] };
      let res = await driver.executeScript(command);
      expect(requestSpy).toHaveBeenCalledOnceWith(
        `${executorUrl}/session/${sessionId}/execute/sync`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json;charset=utf-8'
          },
          body: JSON.stringify(command)
        }
      );
      expect(res).toEqual({ value: 'mockVal' });
    });

    it('throws error', async () => {
      let command = 'abc';
      await expectAsync(driver.executeScript(command)).toBeRejectedWith(
        new Error('Please pass command as {script: "", args: []}')
      );
    });
  });

  describe('takeScreenshot', () => {
    it('calls requests', async () => {
      let res = await driver.takeScreenshot();
      expect(requestSpy).toHaveBeenCalledOnceWith(
        `${executorUrl}/session/${sessionId}/screenshot`,
        Object({}));
      expect(res).toEqual('mockVal');
    });
  });
});
