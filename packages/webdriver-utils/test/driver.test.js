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
  let passedCapabilities = {
    browser: 'chrome',
    platform: 'win'
  };
  let driver;

  beforeEach(() => {
    requestSpy = spyOn(utils.request, 'fetch').and.returnValue(
      Promise.resolve(mockResponseObject)
    );
    driver = new Driver(sessionId, executorUrl, passedCapabilities);
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

  describe('getCapabilities fallback', () => {
    const mockFailedResponse = {
      body: '{"value": {"message" : "Internal Server Error"}',
      status: 500,
      headers: { 'content-type': 'application/text' }
    };
    let requestFailedSpy;
    const sessionId = '1234';
    const newDriver = new Driver(sessionId, executorUrl, passedCapabilities);

    beforeEach(() => {
      requestFailedSpy = spyOn(utils.request, 'fetch').and.returnValue(
        Promise.resolve(mockFailedResponse)
      );
    });

    it('falls back to passed capabilites', async () => {
      let res = await newDriver.getCapabilites();
      expect(requestFailedSpy).toHaveBeenCalledOnceWith(`${executorUrl}/session/${sessionId}`, Object({}));
      expect(res).toBe(passedCapabilities);
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
      expect(command.script).toEqual('/* percy_automate_script */ \n abc');
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

    it('does not add anchor comment to browserstack_executor', async () => {
      let command = { script: 'browserstack_executor', args: [] };
      let res = await driver.executeScript(command);
      expect(command.script).toEqual('browserstack_executor');
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

  describe('findElement', () => {
    it('calls requests', async () => {
      let using = 'xpath';
      let value = '/html';
      let res = await driver.findElement(using, value);
      expect(requestSpy).toHaveBeenCalledOnceWith(
        `${executorUrl}/session/${sessionId}/element`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json;charset=utf-8'
          },
          body: JSON.stringify({ using, value: value })
        }
      );
      expect(res).toEqual('mockVal');
    });

    it('throws error', async () => {
      let using = 'xpath';
      let value = '/html';
      await expectAsync(driver.executeScript(using, value)).toBeRejectedWith(
        new Error('Please pass command as {script: "", args: []}')
      );
    });
  });

  describe('findElementBoundingBox', () => {
    let xpathFindElementSpy;
    let cssSelectorFindElementSpy;
    beforeEach(() => {
      xpathFindElementSpy = spyOn(Driver.prototype, 'findElementXpath').and.returnValue(Promise.resolve({ x: 0, y: 10, height: 100, width: 100 }));
      cssSelectorFindElementSpy = spyOn(Driver.prototype, 'findElementSelector').and.returnValue(Promise.resolve({ x: 0, y: 10, height: 100, width: 100 }));
    });
    describe('when xpath is passed', () => {
      it('calls the required function', async () => {
        const res = await driver.findElementBoundingBox('xpath', '/xpath1');
        expect(cssSelectorFindElementSpy).toHaveBeenCalledTimes(0);
        expect(xpathFindElementSpy).toHaveBeenCalledTimes(1);
        expect(xpathFindElementSpy).toHaveBeenCalledWith('/xpath1');
        expect(res).toEqual({ x: 0, y: 10, height: 100, width: 100 });
      });
    });

    describe('when selector is passed', () => {
      it('calls the required function', async () => {
        const res = await driver.findElementBoundingBox('css selector', '#id1');
        expect(xpathFindElementSpy).toHaveBeenCalledTimes(0);
        expect(cssSelectorFindElementSpy).toHaveBeenCalledTimes(1);
        expect(cssSelectorFindElementSpy).toHaveBeenCalledWith('#id1');
        expect(res).toEqual({ x: 0, y: 10, height: 100, width: 100 });
      });
    });

    describe('when invalid is passed', () => {
      it('calls nothing', async () => {
        await driver.findElementBoundingBox('abc', '#id1');
        expect(xpathFindElementSpy).toHaveBeenCalledTimes(0);
        expect(cssSelectorFindElementSpy).toHaveBeenCalledTimes(0);
      });
    });
  });

  describe('findElementXpath', () => {
    let executeScriptSpy;
    beforeEach(() => {
      executeScriptSpy = spyOn(Driver.prototype, 'executeScript').and.returnValue(Promise.resolve({ value: { x: 0, y: 10, height: 100, width: 100 } }));
    });
    it('calls requests', async () => {
      const res = await driver.findElementXpath('/xpath1');
      expect(executeScriptSpy).toHaveBeenCalledWith({ script: "return document.evaluate('/xpath1', document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue.getBoundingClientRect();", args: [] });
      expect(res).toEqual({ x: 0, y: 10, height: 100, width: 100 });
    });
  });

  describe('findElementSelector', () => {
    let executeScriptSpy;
    beforeEach(() => {
      executeScriptSpy = spyOn(Driver.prototype, 'executeScript').and.returnValue(Promise.resolve({ value: { x: 0, y: 10, height: 100, width: 100 } }));
    });
    it('calls requests', async () => {
      const res = await driver.findElementSelector('#id1');
      expect(executeScriptSpy).toHaveBeenCalledWith({ script: "return document.querySelector('#id1').getBoundingClientRect();", args: [] });
      expect(res).toEqual({ x: 0, y: 10, height: 100, width: 100 });
    });
  });

  describe('rect', () => {
    it('calls requests', async () => {
      const elementId = 'element';
      let res = await driver.rect(elementId);
      expect(requestSpy).toHaveBeenCalledOnceWith(
        `${executorUrl}/session/${sessionId}/element/${elementId}/rect`,
        Object({}));
      expect(res).toEqual('mockVal');
    });
  });

  describe('requestPostOptions', () => {
    const command = { simple: 'test' };
    const expectedResponse = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json;charset=utf-8'
      },
      body: JSON.stringify(command)
    };
    it('returns post options', () => {
      expect(Driver.requestPostOptions(command)).toEqual(expectedResponse);
    });
  });
});
