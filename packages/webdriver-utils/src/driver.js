import fetch from 'node-fetch';

export default class Driver {
  constructor(sessionId, executorUrl) {
    this.sessionId = sessionId;
    this.executorUrl = executorUrl;
  }

  async getCapabilites() {
    const baseUrl = `${this.executorUrl}/session/${this.sessionId}`;
    const caps = await (await fetch(baseUrl)).json();
    return caps.value;
  }

  async getWindowSize() {
    const baseUrl = `${this.executorUrl}/session/${this.sessionId}/window/current/size`;
    const windowSize = (await fetch(baseUrl)).json();
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
    const response = (await fetch(baseUrl, options)).json();
    return response;
  }

  async takeScreenshot() {
    const baseUrl = `${this.executorUrl}/session/${this.sessionId}/screenshot`;
    const screenShot = await (await fetch(baseUrl)).json();
    return screenShot.value;
  }
}
