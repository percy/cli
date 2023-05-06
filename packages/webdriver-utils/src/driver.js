import utils from '@percy/sdk-utils';
const { request } = utils;

export default class Driver {
  constructor(sessionId, executorUrl) {
    this.sessionId = sessionId;
    this.executorUrl = executorUrl.includes('@') ? `https://${executorUrl.split('@')[1]}` : executorUrl;
  }

  async getCapabilites() {
    const baseUrl = `${this.executorUrl}/session/${this.sessionId}`;
    const caps = JSON.parse((await request(baseUrl)).body);
    return caps.value;
  }

  async getWindowSize() {
    const baseUrl = `${this.executorUrl}/session/${this.sessionId}/window/current/size`;
    const windowSize = JSON.parse((await request(baseUrl)).body);
    return windowSize;
  }

  // command => {script: "", args: []}
  async executeScript(command) {
    const options = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json;charset=utf-8'
      },
      body: JSON.stringify(command)
    };
    const baseUrl = `${this.executorUrl}/session/${this.sessionId}/execute/sync`;
    const response = JSON.parse((await request(baseUrl, options)).body);
    return response;
  }

  async takeScreenshot() {
    const baseUrl = `${this.executorUrl}/session/${this.sessionId}/screenshot`;
    const screenShot = JSON.parse((await request(baseUrl)).body);
    return screenShot.value;
  }
}
