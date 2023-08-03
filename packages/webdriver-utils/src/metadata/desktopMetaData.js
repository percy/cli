import Cache from '../util/cache.js';

export default class DesktopMetaData {
  constructor(driver, opts) {
    this.driver = driver;
    this.capabilities = opts;
  }

  device() {
    return false;
  }

  browserName() {
    return this.capabilities?.browserName?.toLowerCase();
  }

  browserVersion() {
    return this.capabilities?.browserVersion?.split('.')[0];
  }

  osName() {
    let osName = this.capabilities?.os;
    if (osName) return osName?.toLowerCase();

    osName = this.capabilities?.platform;
    return osName;
  }

  // showing major version
  osVersion() {
    return this.capabilities?.osVersion?.toLowerCase();
  }

  // combination of browserName + browserVersion + osVersion + osName
  deviceName() {
    return this.osName() + '_' + this.osVersion() + '_' + this.browserName() + '_' + this.browserVersion();
  }

  orientation() {
    return 'landscape';
  }

  async windowSize() {
    const dpr = await this.devicePixelRatio();
    const data = await this.driver.getWindowSize();
    const width = parseInt(data.value.width * dpr), height = parseInt(data.value.height * dpr);
    return { width, height };
  }

  async screenResolution() {
    return await Cache.withCache(Cache.resolution, this.driver.sessionId, async () => {
      const data = await this.driver.executeScript({ script: 'return [(window.screen.width * window.devicePixelRatio).toString(), (window.screen.height * window.devicePixelRatio).toString()];', args: [] });
      const screenInfo = data.value;
      return `${screenInfo[0]} x ${screenInfo[1]}`;
    });
  }

  async devicePixelRatio() {
    return await Cache.withCache(Cache.dpr, this.driver.sessionId, async () => {
      const devicePixelRatio = await this.driver.executeScript({ script: 'return window.devicePixelRatio;', args: [] });
      return devicePixelRatio.value;
    });
  }
}
