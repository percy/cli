import Cache from '../util/cache.js';
// Todo: Implement a base metadata for the common functions.
export default class MobileMetaData {
  constructor(driver, opts) {
    this.driver = driver;
    this.capabilities = opts;
  }

  device() {
    return true;
  }

  browserName() {
    return this.capabilities?.browserName?.toLowerCase();
  }

  browserVersion() {
    const bsVersion = this.capabilities.browserVersion?.split('.');
    if (bsVersion?.length > 0) {
      return bsVersion[0];
    }
    return this.capabilities?.version?.split('.')[0];
  }

  browserVersion() {
    const bsVersion = this.capabilities.browserVersion?.split('.');
    if (bsVersion?.length > 0) {
      return bsVersion[0];
    }
    return this.capabilities.version.split('.')[0];
  }

  osName() {
    let osName = this.capabilities?.os?.toLowerCase();
    if (osName === 'mac' && this.browserName() === 'iphone') {
      osName = 'ios';
    }
    return osName;
  }

  osVersion() {
    return this.capabilities?.osVersion?.split('.')[0];
  }

  deviceName() {
    return this.capabilities?.deviceName?.split('-')[0];
  }

  orientation() {
    return this.capabilities?.orientation;
  }

  async windowSize() {
    const dpr = await this.devicePixelRatio();
    const data = await this.driver.getWindowSize();
    const width = parseInt(data.value.width * dpr), height = parseInt(data.value.height * dpr);
    return { width, height };
  }

  async screenResolution() {
    return await Cache.withCache(Cache.resolution, this.driver.sessionId, async () => {
      const data = await this.driver.executeScript({ script: 'return [parseInt(window.screen.width * window.devicePixelRatio).toString(), parseInt(window.screen.height * window.devicePixelRatio).toString()];', args: [] });
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
