import fetch from 'node-fetch';

export default class DriverWrapper {
  constructor(sessionId, executorUrl) {
    this.sessionId = sessionId;
    // https://hub-cloud.browserstack.com/wd/hub
    this.executorUrl = executorUrl;
  }

  async getCapabilites() {
    const baseUrl = `${this.executorUrl}/session/${this.sessionId}`;
    const caps = (await fetch(baseUrl)).json();
    return caps;
  }

  async getWindowSize() {
    // https://hub-cloud.browserstack.com/wd/hub/session/c339c990e148bee627c76ad0e9205846ece378d8/window/current/size
    const baseUrl = `${this.executorUrl}/session/${this.sessionId}/window/current/size`;
    const windowSize = (await fetch(baseUrl)).json();
    return windowSize;
  }

  // command => {script: "", args: []}
  async executeScript(command) {
    const options = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(command)
    };
    const baseUrl = `${this.executorUrl}/session/${this.sessionId}/execute/sync`;
    const response = (await fetch(baseUrl, options)).json();
    return response;
  }

  async takeScreenshot(){
    const baseUrl = `${this.executorUrl}/session/${this.sessionId}/screenshot`;
    const screenShot = (await fetch(baseUrl)).json();
    return screenShot;
  }
}
