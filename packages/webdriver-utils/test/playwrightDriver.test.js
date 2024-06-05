import PlaywrightDriver from '../src/playwrightDriver.js';
import utils from '@percy/sdk-utils';

describe('PlaywrightDriver', () => {
  let requestSpy;
  let mockResponseObject = {
    body: '{"value": "mockVal"}',
    status: 200,
    headers: { 'content-type': 'application/text' }
  };
  let sessionId = '123';
  let driver;

  beforeEach(() => {
    requestSpy = spyOn(utils.request, 'fetch').and.returnValue(
      Promise.resolve(mockResponseObject)
    );
    driver = new PlaywrightDriver(sessionId);
  });

  describe('constructor', () => {
    it('should set sessionId correctly', () => {
      expect(driver.sessionId).toEqual(sessionId);
    });
  });

  describe('requestPostOptions', () => {
    it('should return correct options for a given command', () => {
      const command = { script: 'console.log("Hello, World!")', args: [] };
      const expectedOptions = {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json;charset=utf-8'
        },
        body: JSON.stringify(command)
      };

      const options = driver.requestPostOptions(command);

      expect(options).toEqual(expectedOptions);
    });
  });

  describe('executeScript', () => {
    it('should execute script and handle response correctly', async () => {
      const command = { script: 'console.log("Hello, World!")', args: [] };

      const response = await driver.executeScript(command);

      const expectedCommand = {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json;charset=utf-8'
        },
        body: JSON.stringify({
          script: '/* percy_automate_script */ \n console.log("Hello, World!")',
          args: []
        })
      };

      const baseUrl = `https://cdp.browserstack.com/wd/hub/session/${sessionId}/execute`;

      expect(requestSpy).toHaveBeenCalledWith(baseUrl, expectedCommand);
      expect(response).toEqual({ value: 'mockVal' });
    });

    it('should handle request error and re-throw', async () => {
      requestSpy.and.returnValue(Promise.reject(new Error('Request failed')));
      const command = { script: 'console.log("Hello, World!")', args: [] };

      await expectAsync(driver.executeScript(command)).toBeRejectedWithError(
        'Request failed'
      );
    });

    it('should handle JSON parsing error', async () => {
      requestSpy.and.returnValue(Promise.resolve({ body: 'invalid-json' }));
      const command = { script: 'console.log("Hello, World!")', args: [] };

      await expectAsync(driver.executeScript(command)).toBeRejectedWithError(
        TypeError
      );
    });

    it('should throw error if command is not an object', async () => {
      const command = 'invalid-command';

      await expectAsync(driver.executeScript(command)).toBeRejectedWithError(
        'Please pass command as {script: "", args: []}'
      );
    });

    it('should throw error if command does not contain script key', async () => {
      const command = { args: [] };

      await expectAsync(driver.executeScript(command)).toBeRejectedWithError(
        'Please pass command as {script: "", args: []}'
      );
    });

    it('should throw error if command does not contain args key', async () => {
      const command = { script: 'console.log("Hello, World!")' };

      await expectAsync(driver.executeScript(command)).toBeRejectedWithError(
        'Please pass command as {script: "", args: []}'
      );
    });

    it('should throw error if command has additional keys', async () => {
      const command = {
        script: 'console.log("Hello, World!")',
        args: [],
        otherKey: 'value'
      };

      await expectAsync(driver.executeScript(command)).toBeRejectedWithError(
        'Please pass command as {script: "", args: []}'
      );
    });
  });
});
